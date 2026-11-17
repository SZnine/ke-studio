import { expect, it } from "vitest";
import { ancestors, moveDomain, scopeIds } from "../src/studio/domains";
const domains = [
  { id: "common", name: "通用" },
  { id: "a", name: "数学" },
  { id: "b", name: "几何", parent: "a" },
  { id: "c", name: "圆锥曲线", parent: "b" },
  { id: "d", name: "代数", parent: "a" },
];
it("resolves every ancestor and the shared root exactly once", () => {
  expect(scopeIds(domains, "c")).toEqual(["common", "a", "b", "c"]);
  expect(scopeIds(domains, "c", "d")).toEqual(["common", "a", "d"]);
  expect(scopeIds(domains, "c", "all")).toHaveLength(5);
});
it("reparents a subtree and reorders siblings without changing their identity", () => {
  const moved = moveDomain(domains, "b", "d", "inside");
  expect(ancestors(moved, "c")).toEqual(["a", "d", "b", "c"]);
  const reordered = moveDomain(domains, "d", "b", "before");
  expect(reordered.filter((d) => d.parent === "a").map((d) => d.id)).toEqual([
    "d",
    "b",
  ]);
});
it("rejects self and descendant drops, and supports moving back to the root", () => {
  expect(() => moveDomain(domains, "a", "c", "inside")).toThrow("子领域");
  expect(() => moveDomain(domains, "b", "b", "inside")).toThrow();
  expect(
    moveDomain(domains, "b", null, "inside").find((d) => d.id === "b")?.parent,
  ).toBeUndefined();
});
