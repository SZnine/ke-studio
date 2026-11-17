import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { initializeWorkspace } from "../src/studio/workspace";
import { scopeIds } from "../src/studio/domains";
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/studio/files", () => ({
  randomUUID: () => "workspace",
  optional: async (name: string) => disk.get(name),
  atomic: async (name: string, text: string) => {
    disk.set(name, text);
  },
  files: { readFile: async (name: string) => disk.get(name) },
}));
it("seeds all 103 math prompts without answers once, preserving an existing question bank", async () => {
  const folder = "initial/banks/default/questions";
  const categories = {
    geometry: 50,
    "number-theory": 17,
    algebra: 16,
    conics: 20,
  };
  expect((await fs.readdir(folder)).sort()).toEqual(
    Object.keys(categories).sort(),
  );
  const names = (
    await Promise.all(
      Object.entries(categories).map(async ([id, count]) => {
        const names = await fs.readdir(folder + "/" + id);
        expect(names).toHaveLength(count);
        return names.map((name) => id + "/" + name);
      }),
    )
  ).flat();
  const questions = await Promise.all(
    names.map((name) => fs.readFile(folder + "/" + name, "utf8")),
  );
  const entries = questions.map((text) => JSON.parse(text));
  expect(entries).toHaveLength(103);
  expect(new Set(entries.map((q) => q.number)).size).toBe(103);
  expect(entries.every((q) => q.prompt && q.ke === "" && q.notes === "")).toBe(
    true,
  );
  expect(
    Object.fromEntries(
      ["几何", "数论", "代数", "圆锥曲线"].map((name) => [
        name,
        entries.filter((q) => q.number.startsWith(name + "-")).length,
      ]),
    ),
  ).toEqual({ 几何: 50, 数论: 17, 代数: 16, 圆锥曲线: 20 });
  const domains = await fs.readFile("initial/shared/domains.json", "utf8");
  expect(JSON.parse(domains).find((d: any) => d.id === "default").name).toBe(
    "数学",
  );
  const tree = JSON.parse(domains);
  expect(tree.map((d: any) => d.name)).toEqual([
    "通用库",
    "数学",
    "几何",
    "数论",
    "代数",
    "圆锥曲线",
  ]);
  for (const id of Object.keys(categories))
    expect(scopeIds(tree, id)).toEqual(["common", "default", id]);
  const template = Object.fromEntries(
    names.map((name, i) => ["banks/default/questions/" + name, questions[i]]),
  );
  template["shared/domains.json"] = domains;
  disk.clear();
  await initializeWorkspace(template);
  expect(disk.size).toBe(105);
  const first = Object.keys(template)[0];
  disk.set(first, "user edited");
  await initializeWorkspace(template);
  expect(disk.get(first)).toBe("user edited");
});
