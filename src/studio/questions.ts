import { files as fs } from "./files";
import { path } from "./files";
import { randomUUID } from "./files";
import { atomic, optional } from "./files";
import type { Question, QuestionSummary } from "./language";

/** A question is one atomic file. CO stays in the domain library. */
export class Questions {
  constructor(
    private root: string,
    readonly collection: "questions" | "drafts" = "questions",
  ) {}
  directory(domain: string) {
    return path.join(this.root, this.collection, domain);
  }
  file(domain: string, id: string) {
    if (!/^[\w-]+$/.test(domain) || !/^[\w-]+$/.test(id))
      throw new Error("题目标识无效。");
    return path.join(this.directory(domain), id + ".json");
  }
  async list(domain: string): Promise<Question[]> {
    const names = await fs.readdir(this.directory(domain)).catch((e) => {
      if (e.code === "ENOENT") return [] as string[];
      throw e;
    });
    const records: Question[] = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (name) =>
          JSON.parse(
            await fs.readFile(path.join(this.directory(domain), name), "utf8"),
          ),
        ),
    );
    return records.sort((a, b) =>
      a.number.localeCompare(b.number, "zh-CN", { numeric: true }),
    );
  }
  async get(domain: string, reference: string) {
    const item = (await this.list(domain)).find(
      (q) => q.id === reference || q.number === reference,
    );
    if (!item)
      throw new Error(
        `找不到题目 ${reference || "（未选中）"}，请先查看题目列表。`,
      );
    return item;
  }
  async prepare(
    domain: string,
    input: Partial<Question>,
    create = false,
  ): Promise<Question> {
    const all = await this.list(domain);
    const previous = create ? undefined : all.find((q) => q.id === input.id);
    if (!create && !previous) throw new Error("题目已不存在，请返回题目列表。");
    let nextNumber = all.length + 1;
    while (all.some((q) => q.number === String(nextNumber).padStart(2, "0")))
      nextNumber++;
    const number = (
      input.number ??
      previous?.number ??
      (this.collection === "drafts" ? "草稿-" : "") +
        String(nextNumber).padStart(2, "0")
    ).trim();
    if (!number) throw new Error("题号不能为空。");
    if (
      all.some(
        (q) =>
          q.id !== previous?.id &&
          q.number.toLowerCase() === number.toLowerCase(),
      )
    )
      throw new Error(`题号 ${number} 已存在，请使用其它题号。`);
    return {
      id: previous?.id || randomUUID(),
      number,
      prompt: input.prompt ?? previous?.prompt ?? "",
      ke: input.ke ?? previous?.ke ?? "",
      notes: input.notes ?? previous?.notes ?? "",
      annotations: (input.annotations ?? previous?.annotations ?? []).filter(
        (mark) =>
          ["concept", "operator"].includes(mark.kind) &&
          mark.start >= 0 &&
          mark.end > mark.start &&
          (input.prompt ?? previous?.prompt ?? "").slice(
            mark.start,
            mark.end,
          ) === mark.quote,
      ),
      updated: new Date().toISOString(),
      ...(this.collection === "drafts"
        ? {
            draft: true as const,
            coScope: input.coScope ?? previous?.coScope ?? "all",
          }
        : {}),
    };
  }
  async write(domain: string, item: Question) {
    await atomic(
      this.file(domain, item.id),
      JSON.stringify(item, null, 2) + "\n",
    );
  }
  async remove(domain: string, reference: string) {
    const item = await this.get(domain, reference);
    await fs.unlink(this.file(domain, item.id));
    return item;
  }
}
export const questionSummary = ({
  ke,
  notes,
  annotations,
  ...item
}: Question): QuestionSummary => item;
