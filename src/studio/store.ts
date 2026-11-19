import { files as fs } from "./files";
import { path } from "./files";
import { randomUUID } from "./files";
import { version } from "../../package.json";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { atomic, optional } from "./files";
import { workspaceInfo } from "./workspace";
import { ancestors, moveDomain, scopeIds, domainSources } from "./domains";
import { scopedSources } from "./library-scope";
import { CoCatalog, supplementalCo } from "./co-catalog";
import type { LanguageEngine, Language } from "./engine";
import {
  CokeCase,
  Domain,
  Entry,
  entryKey,
  LibraryEdit,
  Question,
  Workspace,
} from "./language";
import { Questions, questionSummary } from "./questions";

import { inspectCoke } from "./coke";

const contextKey = (input: object) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(input)))).slice(
    0,
    16,
  );
export interface Change {
  id: string;
  time: string;
  file: string;
  reason: string;
  before: string;
  after: string;
}

/** One current file per resource. Previous content lives only in the change log. */
export class Store {
  readonly questions: Questions;
  readonly drafts: Questions;
  private queue = Promise.resolve();
  private editorContexts = new Map<
    string,
    {
      language: Language;
      revision: string;
      profile: ReturnType<Language["context"]> | Error;
      discovery?: ReturnType<Language["context"]>;
    }
  >();
  constructor(
    readonly root: string,
    readonly engine: LanguageEngine,
    readonly folder = "",
    readonly catalog = new CoCatalog(),
  ) {
    this.questions = new Questions(root);
    this.drafts = new Questions(root, "drafts");
  }
  file(name: string) {
    return path.join(
      name === "domains.json" || name.startsWith("libraries/")
        ? "shared"
        : this.root,
      name,
    );
  }
  async domains(): Promise<Domain[]> {
    return JSON.parse(await fs.readFile(this.file("domains.json"), "utf8"));
  }
  async domain(id: string) {
    const domain = (await this.domains()).find((item) => item.id === id);
    if (!domain) throw new Error("领域不存在。");
    return domain;
  }

  async firstDomain() {
    const domains = await this.domains();
    const ordinary = domains.filter((domain) => domain.id !== "common");
    const populated = await Promise.all(
      ordinary.map(async ({ id }) => {
        try {
          return (await fs.readdir(this.questions.directory(id))).some((name) =>
            name.endsWith(".json"),
          );
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error;
          return false;
        }
      }),
    );
    return ordinary[populated.indexOf(true)]?.id ?? ordinary[0]?.id ?? "common";
  }
  async workspace(
    id = "default",
    questionId?: string,
    draft = false,
  ): Promise<Workspace> {
    const domains = await this.domains();
    const domain = domains.find((item) => item.id === id);
    if (!domain) throw new Error("领域不存在。");
    const [local, questions, drafts, usageFile, allLibraries] =
      await Promise.all([
        workspaceInfo(),
        this.questions.list(id),
        this.drafts.list(id),
        optional(this.file(`usage/${id}.json`)),
        this.libraries(domains),
      ]);
    const question = questionId
      ? (draft ? drafts : questions).find((q) => q.id === questionId)
      : undefined;
    const scope =
      question?.draft && domains.some((d) => d.id === question.coScope)
        ? question.coScope
        : undefined;
    const preference = scopeIds(domains, id, scope);
    const service = this.engine.service;
    const coreEntries = service.coreEntries;
    const libraries = allLibraries.map((lib) => ({
      ...lib,
      entries: service.readHeader(lib.text, lib.id + ".keh").entries,
    }));
    const scoped = preference.flatMap((key) =>
      libraries.filter((lib) => lib.id === key),
    );
    const other = libraries.filter((lib) => !preference.includes(lib.id));
    const starterLibraries = this.engine.active?.starterLibraries ?? [];
    const topic = scope ?? id;
    const topicSeed = starterLibraries.find((lib) => lib.domain === topic);
    const usedEntries = this.catalog.entries;
    const scopedEntries = scoped.flatMap((lib) => lib.entries);
    const fallback = supplementalCo(
      [
        other.flatMap((lib) => lib.entries),
        topicSeed?.entries ?? [],
        starterLibraries
          .filter((lib) => lib !== topicSeed)
          .flatMap((lib) => lib.entries),
        usedEntries,
      ],
      scopedEntries,
      coreEntries,
    );
    const usage = JSON.parse(usageFile || "{}");
    return {
      storage: {
        folder: this.folder,
        bank: this.root.split("/").at(-1)!,
        banks: local.banks,
      },
      version,
      domains,
      domain,
      language: await this.engine.state(),
      editorContext: this.prepareEditorContext(scoped, usage, fallback),
      libraries,
      starterLibraries,
      usedEntries,
      editorEntries: [...coreEntries, ...fallback, ...scopedEntries],
      questions: questions.map(questionSummary),
      drafts: drafts.map(questionSummary),
      question,
      coreEntries,
      usage,
    };
  }
  private prepareEditorContext(
    libraries: Awaited<ReturnType<Store["libraries"]>>,
    usage: Record<string, number>,
    fallback: Entry[],
  ) {
    const { service: language, revision } = this.engine.active!;
    const key = contextKey({
      revision,
      libraries: libraries.map(({ id, name, text }) => ({ id, name, text })),
      usage,
      fallback,
    });
    if (this.editorContexts.get(key)?.language !== language) {
      if (this.editorContexts.size >= 8)
        this.editorContexts.delete(this.editorContexts.keys().next().value!);
      let profile: ReturnType<Language["context"]> | Error;
      let discovery: ReturnType<Language["context"]> | undefined;
      try {
        profile = this.context(libraries, usage, language);
        if (fallback.length) {
          try {
            const discovered = fallback
              .map((entry) => language.renderEntry(entry))
              .join("\n");
            discovery = language.context(
              [
                ...scopedSources(language, libraries),
                { id: "catalog", name: "CO 索引", text: discovered },
              ],
              usage,
            );
          } catch {
            // A conflicting optional definition must not prevent the current question from opening.
          }
        }
      } catch (error) {
        // Keep the library editor accessible when an externally edited CO file is invalid.
        profile = error instanceof Error ? error : new Error(String(error));
      }
      this.editorContexts.set(key, {
        language,
        revision,
        profile,
        discovery,
      });
    }
    return key;
  }
  /** Typing consumes an immutable scope snapshot; autosaves never hold up completion. */
  async inspectEditor(
    input: {
      domain: string;
      questionId?: string;
      draft?: boolean;
      editorContext?: string;
      text: string;
      offset?: number;
      completion?: Parameters<Language["inspect"]>[3];
      annotation?: Parameters<Language["annotate"]>[1];
      move?: { start: number; end: number };
    },
    format = false,
  ) {
    let snapshot = this.editorContexts.get(input.editorContext || "");
    if (!snapshot || snapshot.language !== this.engine.active?.service) {
      const state = await this.mutate(() =>
        this.workspace(input.domain, input.questionId, input.draft),
      );
      snapshot = this.editorContexts.get(state.editorContext);
    }
    if (!snapshot) throw new Error("语言服务尚未就绪。");
    const { language, revision, profile, discovery } = snapshot;
    if (profile instanceof Error) throw profile;
    return {
      ...(input.annotation
        ? language.annotate(input.text, input.annotation, profile, discovery)
        : input.move
          ? language.moveDeclaration(
              input.text,
              input.move,
              input.offset || 0,
              profile,
            )
          : format
            ? { text: language.format(input.text, profile) }
            : await language.inspect(
                input.text,
                input.offset || 0,
                profile,
                input.completion,
                discovery,
              )),
      languageRevision: revision,
    };
  }
  indexCo() {
    return this.catalog.load(this.engine.service, () =>
      this.catalogDocuments(),
    );
  }

  private async *catalogDocuments() {
    const [workspace, domains] = await Promise.all([
      workspaceInfo(),
      this.domains(),
    ]);
    for (const { id: bank } of workspace.banks) {
      for (const { id: domain } of domains) {
        for (const collection of ["questions", "drafts"] as const) {
          const questions = new Questions("banks/" + bank, collection);
          for (const question of await questions.list(domain))
            yield {
              key: `${bank}/${domain}/${collection}/${question.id}`,
              text: question.ke,
            };
        }
        const cases: CokeCase[] = JSON.parse(
          (await optional(`banks/${bank}/coke/${domain}.json`)) || "[]",
        );
        for (const example of cases)
          yield {
            key: `${bank}/${domain}/coke/${example.id}`,
            text: `${example.co}\n${example.ke}`,
          };
      }
    }
  }

  private updateCatalog(
    domain: string,
    collection: string,
    id: string,
    text: string,
  ) {
    const bank = this.root.split("/").at(-1)!;
    return this.catalog.update(
      this.engine.service,
      `${bank}/${domain}/${collection}/${id}`,
      text,
    );
  }
  context(
    libraries: Awaited<ReturnType<Store["libraries"]>>,
    usage = {},
    language = this.engine.service,
  ) {
    return language.context(scopedSources(language, libraries), usage);
  }
  async history(): Promise<Change[]> {
    return ((await optional(this.file("history.jsonl"))) || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  async coke(id: string): Promise<CokeCase[]> {
    await this.domain(id);
    return JSON.parse((await optional(this.file(`coke/${id}.json`))) || "[]");
  }
  async libraries(domains?: Domain[]) {
    return Promise.all(
      (domains ?? (await this.domains())).map(async (domain) => ({
        ...domain,
        text: await fs.readFile(
          this.file(`libraries/${domain.id}.keh`),
          "utf8",
        ),
      })),
    );
  }
  async checkCoke(
    language = this.engine.service,
    libraries?: Awaited<ReturnType<Store["libraries"]>>,
  ) {
    const sources = libraries || (await this.libraries());
    const results = [];
    const banks = (await workspaceInfo()).banks;
    const domains = await this.domains();
    for (const bank of banks)
      for (const domain of domains) {
        const cases = JSON.parse(
          (await optional(`banks/${bank.id}/coke/${domain.id}.json`)) || "[]",
        );
        results.push(
          ...(await inspectCoke(language, sources, domain.id, cases)),
        );
      }
    return results;
  }
  async requireCoke(
    language: Language,
    libraries: Awaited<ReturnType<Store["libraries"]>>,
  ) {
    const results = await this.checkCoke(language, libraries);
    const failures = results.filter((r) => r.confirmed && r.issues.length);
    if (failures.length)
      throw new Error(
        "标准例回归未通过，未应用修改：\n" +
          failures
            .map(
              (r) =>
                `${r.title}：${r.issues.map((i) => `第 ${i.line} 行 ${i.message}`).join("；")}`,
            )
            .join("\n"),
      );
    return results.filter((r) => r.confirmed).length;
  }
  async saveCoke(id: string, input: Partial<CokeCase>, remove = false) {
    const cases = await this.coke(id);
    const index = cases.findIndex((c) => c.id === input.id);
    if (remove) {
      if (index < 0) throw new Error("标准例不存在。");
      cases.splice(index, 1);
    } else {
      const item: CokeCase = {
        id: index >= 0 ? cases[index].id : randomUUID(),
        title: String(input.title || "").trim(),
        naturalLanguage: String(input.naturalLanguage || "").trim(),
        co: String(input.co || ""),
        ke: String(input.ke || ""),
        notes: String(input.notes || ""),
        confirmed: input.confirmed === true,
        updated: new Date().toISOString(),
      };
      if (!item.title || !item.naturalLanguage || !item.ke.trim())
        throw new Error("请填写名称、原文和 KE。");
      if (item.confirmed) {
        const [result] = await inspectCoke(
          this.engine.service,
          await this.libraries(),
          id,
          [item],
        );
        if (result.issues.length)
          throw new Error(
            result.issues
              .map((i) => `第 ${i.line} 行：${i.message}`)
              .join("\n"),
          );
      }
      if (index >= 0) cases[index] = item;
      else cases.push(item);
    }
    await this.change(
      `coke/${id}.json`,
      JSON.stringify(cases, null, 2) + "\n",
      remove ? "删除标准例" : "编辑标准例",
    );
    if (remove && input.id) this.updateCatalog(id, "coke", input.id, "");
    for (const example of cases)
      this.updateCatalog(
        id,
        "coke",
        example.id,
        `${example.co}\n${example.ke}`,
      );
    return cases;
  }
  async change(file: string, text: string, reason: string) {
    const before = (await optional(this.file(file))) || "";
    if (before === text) return;
    await atomic(this.file(file), text);
    return this.record(file, before, text, reason);
  }
  async record(file: string, before: string, text: string, reason: string) {
    const change: Change = {
      id: randomUUID(),
      time: new Date().toISOString(),
      file,
      reason,
      before,
      after: text,
    };
    await fs.appendFile(
      this.file("history.jsonl"),
      JSON.stringify(change) + "\n",
      "utf8",
    );
    return change;
  }
  /** Serialize writes independently of editor requests. */
  mutate<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async planLibraries(
    next: Language,
    replacements: Record<string, string> = {},
  ) {
    const domains = await this.domains();
    for (const id of Object.keys(replacements)) await this.domain(id);
    const libraries = (await this.libraries()).map((lib) => ({
      ...lib,
      text: replacements[lib.id] ?? lib.text,
    }));
    for (const domain of domains)
      this.context(domainSources(libraries, domain.id), {}, next);
    return libraries;
  }
  async saveQuestion(
    domain: string,
    input: Partial<Question>,
    create = false,
    reason?: string,
    draft = false,
  ) {
    await this.domain(domain);
    const records = draft ? this.drafts : this.questions;
    const item = await records.prepare(domain, input, create);
    const change =
      create || reason
        ? await this.change(
            `${records.collection}/${domain}/${item.id}.json`,
            JSON.stringify(item, null, 2) + "\n",
            `${reason || (draft ? "新增草稿" : "新增题目")}：${item.number}`,
          )
        : (await records.write(domain, item), undefined);
    const catalogChanged = this.updateCatalog(
      domain,
      records.collection,
      item.id,
      item.ke,
    );
    return { question: item, change, catalogChanged };
  }
  async deleteQuestion(domain: string, id: string, draft = false) {
    await this.domain(domain);
    const records = draft ? this.drafts : this.questions;
    const item = await records.get(domain, id);
    const change = await this.record(
      `${records.collection}/${domain}/${item.id}.json`,
      JSON.stringify(item, null, 2) + "\n",
      "",
      `删除${draft ? "草稿" : "题目"}：${item.number}`,
    );
    await records.remove(domain, item.id);
    this.updateCatalog(domain, records.collection, item.id, "");
    return change;
  }
  async publishDraft(
    domain: string,
    id: string,
    number?: string,
    target = domain,
  ) {
    const draft = await this.drafts.get(domain, id);
    const result = await this.saveQuestion(
      target,
      { ...draft, number: number?.trim() || undefined },
      true,
      "草稿存入题库",
    );
    await this.deleteQuestion(domain, id, true);
    return result.question;
  }
  async addDomain(name: string, parent?: string) {
    if (parent) await this.domain(parent);
    if (!name.trim()) throw new Error("请输入领域名称。");
    const domain = {
      id: randomUUID(),
      name: name.trim(),
      parent: parent === "common" ? undefined : parent,
    };
    const domains = [...(await this.domains()), domain];
    await atomic(this.file(`libraries/${domain.id}.keh`), "");
    await this.change(
      "domains.json",
      JSON.stringify(domains, null, 2) + "\n",
      `新增领域：${domain.name}`,
    );
    return domain;
  }
  async updateDomain(
    id: string,
    input: {
      name?: string;
      target?: string | null;
      position?: "before" | "inside" | "after";
    },
  ) {
    await this.domain(id);
    if (id === "common") throw new Error("通用库固定为所有领域共用。");
    let domains = await this.domains();
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error("请输入领域名称。");
      domains = domains.map((d) =>
        d.id === id ? { ...d, name: input.name!.trim() } : d,
      );
    }
    if (input.position)
      domains = moveDomain(domains, id, input.target || null, input.position);
    const libraries = (await this.libraries()).map((lib) => ({
      ...lib,
      ...domains.find((d) => d.id === lib.id),
    }));
    for (const domain of domains)
      this.context(domainSources(libraries, domain.id));
    await this.requireCoke(this.engine.service, libraries);
    return this.change(
      "domains.json",
      JSON.stringify(domains, null, 2),
      "调整领域",
    );
  }
  async deleteDomain(id: string) {
    const domain = await this.domain(id);
    if (id === "common") throw new Error("通用库不能删除。");
    const domains = await this.domains();
    const removed = domains.filter((d) =>
      ancestors(domains, d.id).includes(id),
    );
    const data: Record<string, string> = {};
    const workspace = await workspaceInfo();
    for (const d of removed) {
      data[`shared/libraries/${d.id}.keh`] = await fs.readFile(
        this.file(`libraries/${d.id}.keh`),
      );
      for (const bank of workspace.banks) {
        for (const kind of ["questions", "drafts", "proposals"]) {
          const folder = `banks/${bank.id}/${kind}/${d.id}`;
          for (const [name, text] of Object.entries(await fs.snapshot(folder)))
            data[folder + "/" + name] = text;
        }
        for (const kind of ["chats", "coke", "usage"]) {
          const file = `banks/${bank.id}/${kind}/${d.id}.json`,
            text = await optional(file);
          if (text !== undefined) data[file] = text;
        }
      }
    }
    const archive = `trash/${randomUUID()}.json`;
    await atomic(
      archive,
      JSON.stringify({ domains: removed, files: data }, null, 2),
    );
    await atomic(
      this.file("domains.json"),
      JSON.stringify(
        domains.filter((d) => !removed.some((r) => r.id === d.id)),
        null,
        2,
      ),
    );
    await this.record("domain-delete", archive, "", `删除领域：${domain.name}`);
    for (const name of Object.keys(data)) await fs.unlink(name);
    this.catalog.removeDomains(removed.map((domain) => domain.id));
    return removed;
  }
  async checkLibrary(id: string, text: string) {
    await this.planLibraries(this.engine.service, { [id]: text });
    return text;
  }
  async saveLibrary(id: string, text: string, reason = "编辑 CO 库") {
    await this.checkLibrary(id, text);
    await this.requireCoke(
      this.engine.service,
      (await this.libraries()).map((lib) =>
        lib.id === id ? { ...lib, text } : lib,
      ),
    );
    return this.change(`libraries/${id}.keh`, text, reason);
  }
  async editLibrary(id: string, edits: LibraryEdit[], reason = "编辑 CO") {
    await this.domain(id);
    const text = applyLibraryEdits(
      await fs.readFile(this.file(`libraries/${id}.keh`), "utf8"),
      edits,
      this.engine.service,
    );
    return this.saveLibrary(id, text, reason);
  }
  async createCo(id: string, entry: Entry, questionId?: string, draft = false) {
    if (!["concept", "operator"].includes(entry.kind))
      throw new Error("只能新增概念或算子。");
    const state = await this.workspace(id, questionId, draft);
    const entries = state.editorEntries;
    if (entries.some((existing) => existing.name === entry.name))
      throw new Error("同名 CO 已存在，请直接选择或在字典中编辑。");
    const target =
      state.question?.draft &&
      state.domains.some((d) => d.id === state.question?.coScope)
        ? state.question.coScope!
        : id;
    await this.editLibrary(target, [{ entry }], "从原文工具新建 CO");
    return this.workspace(id, questionId, draft);
  }
  async restore(id: string) {
    const change = (await this.history()).find((item) => item.id === id);
    if (!change) throw new Error("记录不存在。");
    if (change.file === "domain-delete") {
      const saved = await optional(change.before);
      if (!saved) throw new Error("该领域已恢复。");
      const archive = JSON.parse(saved) as {
        domains: Domain[];
        files: Record<string, string>;
      };
      const domains = await this.domains();
      for (const domain of archive.domains)
        if (domains.some((d) => d.id === domain.id))
          throw new Error("领域已存在，未覆盖现有内容。");
      for (const [name, text] of Object.entries(archive.files))
        await atomic(name, text);
      const next = [
        ...domains,
        ...archive.domains.map((d) => ({
          ...d,
          parent: [...domains, ...archive.domains].some(
            (p) => p.id === d.parent,
          )
            ? d.parent
            : undefined,
        })),
      ];
      await atomic(this.file("domains.json"), JSON.stringify(next, null, 2));
      await fs.unlink(change.before);
      this.catalog.restoreDomains(archive.domains.map((domain) => domain.id));
      await this.indexCo();
      return [
        await this.record(
          "domain-restore",
          "",
          JSON.stringify(archive.domains.map((d) => d.id)),
          `恢复领域：${archive.domains[0].name}`,
        ),
      ];
    }
    const questionFile = change.file.match(
      /^(questions|drafts)\/([\w-]+)\/([\w-]+)\.json$/,
    );
    if (questionFile) {
      const [, collection, domain, id] = questionFile;
      const records = collection === "drafts" ? this.drafts : this.questions;
      await this.domain(domain);
      const exists = (await records.list(domain)).some((q) => q.id === id);
      if (!change.before)
        return exists
          ? [await this.deleteQuestion(domain, id, collection === "drafts")]
          : [];
      const restored = {
        ...(await records.prepare(domain, JSON.parse(change.before), !exists)),
        id,
      };
      const saved = await this.change(
        change.file,
        JSON.stringify(restored, null, 2) + "\n",
        `恢复：${change.reason}`,
      );
      this.updateCatalog(domain, collection, id, restored.ke);
      return saved ? [saved] : [];
    }
    if (change.file.startsWith("libraries/")) {
      const domain = await this.domain(
        path.basename(change.file).replace(/\.keh$/, ""),
      );
      const restored = await this.saveLibrary(
        domain.id,
        change.before,
        `恢复：${change.reason}`,
      );
      return restored ? [restored] : [];
    } else throw new Error("此记录仅供查看。");
  }
  async recount(id: string, files: { name: string; text: string }[]) {
    const state = await this.workspace(id),
      p = this.context(state.libraries);
    const counts: Record<string, number> = Object.fromEntries(
      state.libraries.flatMap((library) =>
        this.engine.service
          .readHeader(library.text, "")
          .entries.filter((entry) =>
            ["concept", "operator"].includes(entry.kind),
          )
          .map((entry) => [entry.name, 0]),
      ),
    );
    for (const file of files) {
      const a = this.engine.service.analyze(file.text, p),
        seen = new Set<number>();
      for (const ref of a.references) {
        if (
          ref.declaration ||
          !ref.target ||
          !["concept", "operator"].includes(ref.target.kind) ||
          seen.has(ref.start)
        )
          continue;
        seen.add(ref.start);
        counts[ref.target.name] = (counts[ref.target.name] || 0) + 1;
      }
    }
    await this.change(
      `usage/${id}.json`,
      JSON.stringify(counts, null, 2) + "\n",
      `统计 ${files.length} 个 KE 文件的引用次数`,
    );
    return counts;
  }
}

export function applyLibraryEdits(
  source: string,
  edits: LibraryEdit[],
  language: Language,
) {
  let text = source;
  for (const edit of edits) {
    const entries = language.readHeader(text, "").entries;
    const previous = edit.key
      ? entries.find((e) => entryKey(e) === edit.key)
      : undefined;
    if (edit.key && !previous) throw new Error(`CO 已不存在：${edit.key}`);
    const next = edit.entry
      ? language.renderEntry({
          ...edit.entry,
          updated: new Date().toISOString().slice(0, 10),
        })
      : "";
    if (previous?.span)
      text =
        text.slice(0, previous.span.start) +
        next +
        text.slice(previous.span.end);
    else if (next)
      text = text.trimEnd() + (text.trim() ? "\n\n" : "") + next + "\n";
  }
  return text;
}
