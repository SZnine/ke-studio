import { files as fs } from "./files";
import { path } from "./files";
import { randomUUID } from "./files";
import { atomic } from "./files";
import { digest } from "./engine";
import { applyLibraryEdits, type Store } from "./store";
import { entryKey, type Proposal, type ProposalItem } from "./language";
import { patchSources } from "./source-edits";

/** Only pending suggestions live here. Decisions and prior content live in history. */
export class Reviews {
  constructor(private store: Store) {}
  file(domain: string, id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error("建议 ID 无效。");
    return this.store.file(`proposals/${domain}/${id}.json`);
  }
  async list(domain: string): Promise<Proposal[]> {
    const folder = this.store.file(`proposals/${domain}`);
    const names = await fs.readdir(folder).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    const proposals: Proposal[] = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (name) =>
          JSON.parse(await fs.readFile(path.join(folder, name), "utf8")),
        ),
    );
    return proposals.sort((a, b) => a.created.localeCompare(b.created));
  }
  /** Rebase independent suggestions; only changes to the same entry are conflicts. */
  async rebase(items: ProposalItem[]) {
    const libraries = await this.store.libraries();
    const service = this.store.engine.service;
    const comparable = (text: string) => {
      const entry = service.readHeader(text, "").entries[0];
      return entry
        ? service.renderEntry({ ...entry, updated: undefined })
        : text;
    };
    const pending: ProposalItem[] = [];
    for (const item of items) {
      if (item.edit) {
        const lib = libraries.find((lib) => lib.id === item.library);
        if (!lib) throw new Error(`找不到建议所属的库：${item.library}`);
        const key =
          item.edit.key || (item.edit.entry && entryKey(item.edit.entry));
        const entries = service.readHeader(lib.text, lib.id).entries;
        const current =
          entries.find((entry) => entryKey(entry) === key) ||
          (item.edit.entry &&
            entries.find(
              (entry) => entryKey(entry) === entryKey(item.edit!.entry!),
            ));
        const text = current
          ? service.renderEntry({ ...current, updated: undefined })
          : "";
        if (text === comparable(item.after)) continue;
        if (text !== comparable(item.before))
          throw new Error(
            `「${item.title}」已被修改，请重新分析这一项；其余建议仍可采纳。`,
          );
      }
      pending.push(item);
    }
    return pending;
  }
  async candidate(items: ProposalItem[]) {
    const sources = items.flatMap((item) => (item.source ? [item.source] : []));
    const files = sources.length
      ? patchSources(await this.store.engine.sources(), sources)
      : {};
    const replacements: Record<string, string> = {};
    for (const lib of await this.store.libraries()) {
      const edits = items
        .filter((item) => item.library === lib.id)
        .map((item) => item.edit!);
      if (edits.length)
        replacements[lib.id] = applyLibraryEdits(
          lib.text,
          edits,
          this.store.engine.service,
        );
    }
    return { files, replacements };
  }
  async propose(domain: string, input: any) {
    await this.store.domain(domain);
    const files = await this.store.engine.sources();
    const libraries = await this.store.libraries();
    if (input.replaceProposal && input.appendProposal)
      throw new Error("覆盖和追加建议不能同时使用。");
    const previousId = input.appendProposal || input.replaceProposal;
    const previous =
      previousId && (await this.list(domain)).find((p) => p.id === previousId);
    if (previousId && !previous)
      throw new Error("待审建议已处理，请重新生成。");
    const items: ProposalItem[] = [];
    if (input.language) {
      if (input.language.revision !== digest(files))
        throw new Error("语言已更新，请重新读取。");
      patchSources(files, input.language.edits);
      for (const edit of input.language.edits)
        items.push({
          id: randomUUID(),
          title: edit.file,
          before: edit.before,
          after: edit.after,
          source: { file: edit.file, before: edit.before, after: edit.after },
          reason: edit.reason || input.reason,
          recommended: edit.recommended !== false,
        });
    }
    for (const update of input.libraries || []) {
      const id = update.domain || domain,
        lib = libraries.find((l) => l.id === id);
      if (!lib) throw new Error("找不到领域库；内置 CO 请修改 core.keh。");
      if (update.revision !== digest({ text: lib.text }))
        throw new Error("CO 库已更新，请重新读取。");
      const old = this.store.engine.service.readHeader(
        lib.text,
        lib.id,
      ).entries;
      for (const edit of update.edits || []) {
        const previous = edit.key
          ? old.find((e) => entryKey(e) === edit.key)
          : undefined;
        const before = previous
          ? this.store.engine.service.renderEntry(previous)
          : "";
        const after = edit.entry
          ? this.store.engine.service.renderEntry(edit.entry)
          : "";
        if (before === after) continue;
        items.push({
          id: randomUUID(),
          title: edit.entry?.name || previous?.name || edit.key,
          library: id,
          edit: { key: edit.key, entry: edit.entry },
          before,
          after,
          reason: edit.reason || input.reason,
          recommended: edit.recommended !== false,
        });
      }
    }
    if (!items.length) throw new Error("没有需要更新的内容。");
    const merged = input.appendProposal
      ? await this.rebase(previous.items)
      : [];
    for (const item of items) {
      const key =
        item.edit?.key || (item.edit?.entry && entryKey(item.edit.entry));
      const index = merged.findIndex((old) =>
        item.edit
          ? old.library === item.library &&
            (key === old.edit?.key ||
              (old.edit?.entry && key === entryKey(old.edit.entry)))
          : old.source?.file === item.source?.file &&
            old.before === item.before,
      );
      if (index < 0) merged.push(item);
      else {
        const old = merged[index];
        merged[index] = {
          ...item,
          id: old.id,
          before: old.before,
          ...(item.edit ? { edit: { ...item.edit, key: old.edit?.key } } : {}),
        };
      }
    }
    const candidate = await this.candidate(merged);
    const checked = await this.store.planUpdate(
      candidate.files,
      candidate.replacements,
    );
    const proposal: Proposal = {
      id: previousId || randomUUID(),
      domain,
      reason: input.appendProposal ? previous.reason : input.reason,
      created: previous?.created || new Date().toISOString(),
      items: merged,
    };
    await atomic(
      this.file(domain, proposal.id),
      JSON.stringify(proposal, null, 2) + "\n",
    );
    return {
      proposal: {
        id: proposal.id,
        reason: proposal.reason,
        count: merged.length,
      },
      status: "awaiting_user",
      checkedCoke: checked.checked,
      message: "仅生成待审建议，尚未修改。请用户勾选后采纳。",
    };
  }
  async decide(domain: string, id: string, selected: string[]) {
    await this.store.domain(domain);
    const proposal = (await this.list(domain)).find((p) => p.id === id);
    if (!proposal) throw new Error("建议已处理，请刷新。");
    if (
      !Array.isArray(selected) ||
      selected.some((id) => !proposal.items.some((item) => item.id === id))
    )
      throw new Error("所选建议无效。");
    if (selected.length) {
      const items = await this.rebase(
        proposal.items.filter((item) => selected.includes(item.id)),
      );
      if (items.length) {
        const candidate = await this.candidate(items);
        await this.store.saveUpdate(
          candidate.files,
          candidate.replacements,
          "采纳建议：" + proposal.reason,
        );
      }
    }
    await this.store.record(
      "review/" + id,
      JSON.stringify(proposal),
      JSON.stringify({
        selected,
        status: selected.length ? "applied" : "dismissed",
      }),
      selected.length ? `采纳 ${selected.length} 项建议` : "忽略建议",
    );
    await fs.unlink(this.file(domain, id));
  }
}
