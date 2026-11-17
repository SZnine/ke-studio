import type { Domain } from "./language";

export function ancestors(domains: Domain[], id: string): string[] {
  const result: string[] = [];
  let current = domains.find((d) => d.id === id);
  while (current) {
    if (result.includes(current.id)) throw new Error("领域不能循环嵌套。");
    result.unshift(current.id);
    current = domains.find((d) => d.id === current!.parent);
  }
  return result;
}
export function scopeIds(domains: Domain[], id: string, scope?: string) {
  return scope === "all"
    ? domains.map((d) => d.id)
    : [...new Set(["common", ...ancestors(domains, scope || id)])];
}
export function moveDomain(
  domains: Domain[],
  id: string,
  target: string | null,
  position: "before" | "inside" | "after",
) {
  if (id === "common" || id === target) throw new Error("不能移动到此位置。");
  const item = domains.find((d) => d.id === id);
  const destination = domains.find((d) => d.id === target);
  if (!item || (target && (!destination || target === "common")))
    throw new Error("领域不存在。");
  const parent =
    position === "inside" ? target || undefined : destination?.parent;
  if (parent && ancestors(domains, parent).includes(id))
    throw new Error("不能把父领域移入自己的子领域。");
  const result = domains.filter((d) => d.id !== id);
  const index = destination
    ? result.findIndex((d) => d.id === target)
    : result.length;
  result.splice(index + (position === "after" ? 1 : 0), 0, { ...item, parent });
  return result;
}

export function domainSources<T extends Domain>(sources: T[], id: string) {
  return scopeIds(sources, id)
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is T => !!source);
}
