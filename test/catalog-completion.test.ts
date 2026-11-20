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
    text: `concept Archived;
concept ArchivedNumber <: Number;
op archived_score(Archived): Number;
op archived_numeric(Number): ArchivedNumber;
op diff_ordered(tuple(Number, Number)): Number;
op diff_other(Number): Number;
op diff_text(tuple(Number, Number)): String;
op diff_binary(Number, Number): Number;
op range(Number): set(Number);`,
  }]);
});

async function inspect(input: string, manual = false) {
  const offset = input.indexOf("§");
  return language.inspect(input.replace("§", ""), offset, profile, { manual, callStyle: "smart" }, discovery);
}

function applyCompletion(input: string, completion: { edits: { start: number; end: number; text: string }[]; replace: { start: number; end: number }; insert: string }) {
  return [...completion.edits, { ...completion.replace, text: completion.insert }]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, { start, end, text: replacement }) => text.slice(0, start) + replacement + text.slice(end),
      input.replace("§", ""),
    );
}

it("never changes document diagnostics or repurposes a name for a catalog completion", async () => {
  const text = "concept Number;\nrange : set(tuple(Number, Number));\nrange = {(1, 2)};";
  const local = await language.inspect(text, text.length, profile);
  const expanded = await language.inspect(text, text.length, profile, {}, discovery);
  expect(expanded.issues).toEqual(local.issues);
  expect(local.issues).toEqual([]);

  const lookup = text + "\nop ran";
  const result = await language.inspect(lookup, lookup.length, profile, { manual: true }, discovery);
  expect(result.completions.some(({ name }) => name === "range")).toBe(false);
  const body = await inspect(text + "\noutput = ran§", true);
  expect(body.completions.find(({ name }) => name === "range")).toMatchObject({ kind: "value", insert: "range" });
});

it("completes catalog declarations with their dependencies", async () => {
  const request = "op archived_§";
  const { completions } = await inspect(request, true);
  const completion = completions.find(({ name }) => name === "archived_score")!;
  expect(completion).toBeDefined();
  const source = applyCompletion(request, completion);
  expect(source).toContain("concept Archived;");
  expect(language.analyze(source, profile).issues).toEqual([]);
});

it("offers explicitly named catalog calls and inserts their declarations on selection", async () => {
  const output = "output = §";
  expect((await inspect(output)).completions.some(({ name }) => name === "archived_score")).toBe(false);

  const template = await inspect("output = archived_s§");
  expect(template.completions.find(({ name }) => name === "archived_score")).toMatchObject({
    insert: "archived_score(${1})", snippet: true,
  });

  const request = "a : Archived;\noutput = archived_§(a);";
  const result = await inspect(request);
  const source = applyCompletion(request, result.completions.find(({ name }) => name === "archived_score")!);
  expect(source).toContain("concept Archived;");
  expect(source).toContain("op archived_score(Archived) : Number;");
  expect(source).toContain("output = archived_score(a);");
  expect(language.analyze(source, profile).issues).toEqual([]);
});

it("uses catalog subtypes in typed expressions and respects local concept declarations", async () => {
  const request = "n : Number;\nn = archived_n§(n);";
  const result = await inspect(request);
  const source = applyCompletion(request, result.completions.find(({ name }) => name === "archived_numeric")!);
  expect(source).toContain("concept ArchivedNumber <: Number;");
  expect(language.analyze(source, profile).issues).toEqual([]);
  const shadowed = await inspect("concept ArchivedNumber;\n" + request);
  expect(shadowed.completions.some(({ name }) => name === "archived_numeric")).toBe(false);
});

it("completes a catalog operator parameter by name and matches the tuple collection", async () => {
  const request = `concept Any;
op sum(set(Any), operator): Number;
pairs : set(tuple(Number, Number));
pairs = {(1, 2)};
output = sum(pairs, diff_§);`;
  const { completions } = await inspect(request);
  expect(completions.map(({ name }) => name)).toEqual(["diff_ordered"]);
  const [completion] = completions;
  expect(completion.insert).toBe("diff_ordered");
  expect(completion.snippet).toBe(false);
  const source = applyCompletion(request, completion);
  expect(source).toContain("op diff_ordered(tuple(Number, Number)) : Number;");
  expect(source).toContain("output = sum(pairs, diff_ordered);");
  expect(language.analyze(source, profile).issues).toEqual([]);
});

it("places a catalog declaration before an entire rule and preserves its calls", async () => {
  const request = "n : Number;\nn = 1 :- n = 1, n = archived_n§(n);";
  const result = await inspect(request);
  const source = applyCompletion(request, result.completions.find(({ name }) => name === "archived_numeric")!);
  expect(source).toContain("op archived_numeric(Number) : ArchivedNumber;");
  expect(source).toContain("n = 1 :- n = 1, n = archived_numeric(n);");
  expect(language.analyze(source, profile).issues).toEqual([]);

  const firstCall = "diff_o§(1) = 1;";
  const first = await inspect(firstCall);
  const firstSource = applyCompletion(firstCall, first.completions.find(({ name }) => name === "diff_other")!);
  expect(firstSource).toContain("\ndiff_other(1) = 1;");
  expect(language.analyze(firstSource, profile).issues).toEqual([]);
});
