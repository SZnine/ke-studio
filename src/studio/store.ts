import { files as fs } from "./files";
import { path } from "./files";
import { randomUUID } from "./files";
import { version } from "../../package.json";
import { atomic, optional } from "./files";
import { preference, savePreference } from "./preferences";
import { workspaceInfo } from "./workspace";
import { ancestors, moveDomain, scopeIds, domainSources } from "./domains";
import { scopedSources } from "./library-scope";
import { digest, LanguageEngine, Language } from "./engine";
import {
  ChatMessage,
  CokeCase,
  Domain,
  entryKey,
  LibraryEdit,
  Question,
  Workspace,
} from "./language";
import { Questions, questionSummary } from "./questions";
import { Reviews } from "./reviews";

import { inspectCoke } from "./coke";
import type { ModelMessage } from "./model";

export interface StoredChatMessage extends ChatMessage {
  trace?: ModelMessage[];
  state?: "running" | "complete" | "stopped" | "error";
}

interface Settings {
  baseUrl: string;
  model: string;
  maxTokens?: number;
}
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
  readonly reviews: Reviews;
  private queue = Promise.resolve();
  private editorContexts = new Map<
    string,
    {
      language: Language;
      revision: string;
      profile: ReturnType<Language["context"]> | Error;
    }
  >();
  constructor(
    readonly root: string,
    readonly engine: LanguageEngine,
    readonly workspaceId = "",
    readonly folder = "",
  ) {
    this.questions = new Questions(root);
    this.drafts = new Questions(root, "drafts");
    this.reviews = new Reviews(this);
    engine.onChange = async (before, after, service) => {
      await this.acceptLanguage(before, after, service, "外部语言文件更新");
    };
  }
  file(name: string) {
    return path.join(
      name === "domains.json" || name.startsWith("libraries/")
        ? "shared"
        : name === "model.json"
          ? "settings"
          : this.root,
      name,
    );
  }
  async initialize() {
    if ((await optional(this.file("model.json"))) === undefined)
      await atomic(
        this.file("model.json"),
        JSON.stringify(
          { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
          null,
          2,
        ),
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
  async settings(): Promise<Settings> {
    return JSON.parse(await fs.readFile(this.file("model.json"), "utf8"));
  }
  async key() {
    const model = await this.settings();
    return (
      (await preference<string>(
        "key:" + this.workspaceId + ":" + new URL(model.baseUrl).origin,
      )) || ""
    );
  }
  async workspace(
    id = "default",
    questionId?: string,
    draft = false,
  ): Promise<Workspace> {
    const domains = await this.domains(),
      domain = await this.domain(id);
    const language = await this.engine.state();
    const model = await this.settings();
    const questions = await this.questions.list(id);
    const drafts = await this.drafts.list(id);
    const question = questionId
      ? (draft ? drafts : questions).find((q) => q.id === questionId)
      : undefined;
    const libraries = await this.scopedLibraries(
      id,
      question?.draft
        ? domains.some((d) => d.id === question.coScope)
          ? question.coScope
          : "all"
        : undefined,
    );
    const local = await workspaceInfo();
    const usage = JSON.parse(
      (await optional(this.file(`usage/${id}.json`))) || "{}",
    );
    return {
      storage: {
        folder: this.folder,
        bank: this.root.split("/").at(-1)!,
        banks: local.banks,
      },
      version,
      domains,
      domain,
      language,
      editorContext: this.engine.active
        ? this.prepareEditorContext(libraries, usage)
        : "",
      libraries: libraries.map((lib) => ({
        ...lib,
        entries: this.engine.active
          ? this.engine.service.readHeader(lib.text, lib.id + ".keh").entries
          : [],
      })),
      model: { ...model, hasKey: !!(await this.key()) },
      questions: questions.map(questionSummary),
      drafts: drafts.map(questionSummary),
      proposals: await this.reviews.list(id),
      question,
      coreEntries: this.engine.active
        ? this.engine.service.readHeader(
            this.engine.service.coreText,
            "core.keh",
          ).entries
        : [],
      usage,
    };
  }
  private prepareEditorContext(
    libraries: Awaited<ReturnType<Store["libraries"]>>,
    usage: Record<string, number>,
  ) {
    const { service: language, revision } = this.engine.active!;
    const key = digest({
      revision,
      libraries: JSON.stringify(libraries),
      usage: JSON.stringify(usage),
    });
    if (this.editorContexts.get(key)?.language !== language) {
      if (this.editorContexts.size >= 8)
        this.editorContexts.delete(this.editorContexts.keys().next().value!);
      let profile: ReturnType<Language["context"]> | Error;
      try {
        profile = this.context(libraries, usage, language);
      } catch (error) {
        // Keep the library editor accessible when an externally edited CO file is invalid.
        profile = error instanceof Error ? error : new Error(String(error));
      }
      this.editorContexts.set(key, {
        language,
        revision,
        profile,
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
    if (!snapshot) throw new Error(this.engine.error || "语言尚未编译。");
    const { language, revision, profile } = snapshot;
    if (profile instanceof Error) throw profile;
    return {
      ...(input.annotation
        ? language.annotate(input.text, input.annotation, profile)
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
              )),
      languageRevision: revision,
    };
  }
  async scopedLibraries(id: string, scope?: string) {
    const domains = await this.domains();
    const preferred = scopeIds(
      domains,
      id,
      scope === "all" ? undefined : scope,
    );
    const order =
      scope === "all"
        ? [
            ...domains.map((d) => d.id).filter((id) => !preferred.includes(id)),
            ...preferred,
          ]
        : preferred;
    const libraries = await this.libraries();
    return order
      .map((id) => libraries.find((lib) => lib.id === id))
      .filter((lib): lib is (typeof libraries)[number] => !!lib);
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
  async chat(id: string): Promise<StoredChatMessage[]> {
    await this.domain(id);
    return JSON.parse((await optional(this.file(`chats/${id}.json`))) || "[]");
  }
  async saveChat(id: string, messages: StoredChatMessage[]) {
    await this.domain(id);
    await atomic(
      this.file(`chats/${id}.json`),
      JSON.stringify(messages, null, 2) + "\n",
    );
  }
  async coke(id: string): Promise<CokeCase[]> {
    await this.domain(id);
    return JSON.parse((await optional(this.file(`coke/${id}.json`))) || "[]");
  }
  async libraries() {
    return Promise.all(
      (await this.domains()).map(async (domain) => ({
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
  /** Serialize the few file writes; reads and model requests do not hold this queue. */
  mutate<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async saveLanguage(files: Record<string, string>, reason = "编辑语言源码") {
    const before = await this.engine.sources();
    const unknown = Object.keys(files).find((name) => !(name in before));
    if (unknown) throw new Error(`未知语言文件：${unknown}`);
    const compiled = await this.engine.compile({ ...before, ...files });
    const changes = await this.acceptLanguage(
      this.engine.active?.files || before,
      compiled.files,
      compiled.service,
      reason,
    );
    await this.engine.commit(compiled);
    return changes;
  }
  async acceptLanguage(
    before: Record<string, string>,
    after: Record<string, string>,
    next: Language,
    reason: string,
  ) {
    const libraries = await this.planLibraries(next);
    await this.requireCoke(next, libraries);
    const changes: Change[] = [];
    for (const lib of libraries) {
      const change = await this.change(
        `libraries/${lib.id}.keh`,
        lib.text,
        reason,
      );
      if (change) changes.push(change);
    }
    if (!Object.keys(before).length) {
      const previous = (await this.history())
        .filter((change) => change.file === "language")
        .at(-1);
      if (previous) before = JSON.parse(previous.after);
    }
    if (JSON.stringify(before) !== JSON.stringify(after))
      changes.push(
        await this.record(
          "language",
          JSON.stringify(before),
          JSON.stringify(after),
          reason,
        ),
      );
    return changes;
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
    // Re-render existing declarations with the new grammar surface. Their meanings,
    // metadata and surrounding comments remain in place; business KE stays untouched.
    for (const lib of libraries) {
      if (!next.readHeader(lib.text, lib.id).issues.length) continue;
      const old = this.engine.active?.service.readHeader(lib.text, lib.id);
      if (!old || old.issues.length)
        throw new Error(
          `库 ${lib.name} 无法按新文法读取，请一并修改语言源码或库声明。`,
        );
      for (const entry of [...old.entries].reverse())
        if (entry.span)
          lib.text =
            lib.text.slice(0, entry.span.start) +
            next.renderEntry(entry) +
            lib.text.slice(entry.span.end);
    }
    for (const domain of domains)
      this.context(domainSources(libraries, domain.id), {}, next);
    return libraries;
  }
  /** Validate the whole replacement before touching current files; one history entry restores it together. */
  async planUpdate(
    files: Record<string, string>,
    replacements: Record<string, string>,
  ) {
    const previous = await this.engine.sources();
    for (const name of Object.keys(files))
      if (!(name in previous)) throw new Error(`未知语言文件：${name}`);
    const compiled = Object.keys(files).length
      ? await this.engine.compile({ ...previous, ...files })
      : this.engine.active!;
    const libraries = await this.planLibraries(compiled.service, replacements);
    const checked = await this.requireCoke(compiled.service, libraries);
    return { previous, compiled, libraries, checked };
  }
  async saveUpdate(
    files: Record<string, string>,
    replacements: Record<string, string>,
    reason: string,
  ) {
    const { previous, compiled, libraries, checked } = await this.planUpdate(
      files,
      replacements,
    );
    const oldLibraries = Object.fromEntries(
      (await this.libraries()).map((l) => [l.id, l.text]),
    );
    const changedLanguage = Object.keys(compiled.files).filter(
      (name) => previous[name] !== compiled.files[name],
    );
    const changedLibraries = libraries.filter(
      (lib) => oldLibraries[lib.id] !== lib.text,
    );
    const before = {
      language: Object.fromEntries(
        changedLanguage.map((name) => [name, previous[name]]),
      ),
      libraries: Object.fromEntries(
        changedLibraries.map((lib) => [lib.id, oldLibraries[lib.id]]),
      ),
    };
    const after = {
      language: Object.fromEntries(
        changedLanguage.map((name) => [name, compiled.files[name]]),
      ),
      libraries: Object.fromEntries(
        changedLibraries.map((lib) => [lib.id, lib.text]),
      ),
    };
    if (JSON.stringify(before) === JSON.stringify(after))
      return { changes: [], checked };
    for (const lib of changedLibraries)
      await atomic(this.file(`libraries/${lib.id}.keh`), lib.text);
    await this.engine.commit(compiled);
    return {
      changes: [
        await this.record(
          "update",
          JSON.stringify(before),
          JSON.stringify(after),
          reason,
        ),
      ],
      checked,
    };
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
    return { question: item, change };
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
  async saveModel(model: Settings, key?: string) {
    const url = new URL(model.baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || !model.model.trim())
      throw new Error("请填写接口地址和模型名称。");
    if (
      model.maxTokens !== undefined &&
      (!Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1)
    )
      throw new Error("输出上限须为正整数，留空使用模型默认值。");
    const name = "key:" + this.workspaceId + ":" + url.origin;
    if (key?.trim()) await savePreference(name, key.trim());
    else if (key === "") await savePreference(name, undefined);
    await this.change(
      "model.json",
      JSON.stringify(model, null, 2) + "\n",
      "更新模型配置",
    );
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
      return saved ? [saved] : [];
    }
    if (change.file === "update") {
      const previous = JSON.parse(change.before);
      return (
        await this.saveUpdate(
          previous.language,
          previous.libraries,
          `恢复：${change.reason}`,
        )
      ).changes;
    }
    if (change.file === "language")
      return this.saveLanguage(
        JSON.parse(change.before),
        `恢复：${change.reason}`,
      );
    else if (change.file.startsWith("libraries/")) {
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
