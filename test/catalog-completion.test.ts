import fs from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { createLanguage } from "../studio/language/index";

let language: Awaited<ReturnType<typeof createLanguage>>;
let profile: ReturnType<typeof language.context>;
let discovery: typeof profile;

beforeAll(async () => {
  const files = Object.fromEntries(await Promise.all(
    ["ke.langium", "core.keh", "manifest.json"].map(async (name) =>
      [name, await fs.readFile(`studio/language/${name}`, "utf8")],
    ),
  ));
  language = await createLanguage(files);
  profile = language.context([]);
  discovery = language.context([{
    id: "catalog",
    name: "CO 索引",
    text: "concept Archived; op archived_score(Archived): Number; op range(Number): set(Number);",
  }]);
});

it("never changes document diagnostics or repurposes a name for a catalog completion", async () => {
  const text = "concept Number;\nrange : set(tuple(Number, Number));\nrange = {(1, 2)};";
  const local = await language.inspect(text, text.length, profile);
  const expanded = await language.inspect(text, text.length, profile, {}, discovery);
  expect(expanded.issues).toEqual(local.issues);
  expect(local.issues).toEqual([]);

  const lookup = text + "\nop ran";
  const result = await language.inspect(lookup, lookup.length, profile, { manual: true }, discovery);
  expect(result.completions.some(({ name }) => name === "range")).toBe(false);
});

it("completes catalog declarations with their dependencies and avoids unresolved bare calls", async () => {
  const request = "op archived_";
  const { completions } = await language.inspect(request, request.length, profile, { manual: true }, discovery);
  const completion = completions.find(({ name }) => name === "archived_score")!;
  expect(completion).toBeDefined();
  const edits = [...completion.edits, { ...completion.replace, text: completion.insert }];
  const source = edits.sort((a, b) => b.start - a.start).reduce(
    (text, { start, end, text: replacement }) => text.slice(0, start) + replacement + text.slice(end),
    request,
  );
  expect(source).toContain("concept Archived;");
  expect(language.analyze(source, profile).issues).toEqual([]);

  const call = "output = archived_";
  const result = await language.inspect(call, call.length, profile, { manual: true }, discovery);
  expect(result.completions.some(({ name }) => name === "archived_score")).toBe(false);
});
