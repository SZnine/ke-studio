import type { SourceEdit } from "./language";

export function patchSources(
  files: Record<string, string>,
  edits: SourceEdit[],
) {
  const next = { ...files };
  if (!Array.isArray(edits) || !edits.length)
    throw new Error("请提供源码修改列表。");
  for (const edit of edits) {
    if (!(edit.file in next) || !edit.before || typeof edit.after !== "string")
      throw new Error("源码修改目标或片段无效。");
    const source = next[edit.file],
      index = source.indexOf(edit.before);
    if (index < 0 || source.indexOf(edit.before, index + 1) >= 0)
      throw new Error(`${edit.file} 中的替换片段不唯一或已改变，请重新读取。`);
    next[edit.file] =
      source.slice(0, index) +
      edit.after +
      source.slice(index + edit.before.length);
  }
  return next;
}
