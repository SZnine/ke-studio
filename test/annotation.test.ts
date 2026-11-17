import { beforeAll, expect, it } from "vitest";
import fs from "node:fs/promises";
import { createLanguage } from "../studio/language/index";
import type { Language } from "../src/studio/engine";
import { applyLibraryEdits } from "../src/studio/store";
import { entryKey, type Entry } from "../src/studio/language";
let language: Language, context: ReturnType<Language["context"]>;
beforeAll(async () => {
  const files = Object.fromEntries(
    await Promise.all(
      (await fs.readdir("studio/language")).map(async (name) => [
        name,
        await fs.readFile("studio/language/" + name, "utf8"),
      ]),
    ),
  );
  language = await createLanguage(files);
  context = language.context([
    {
      id: "conics",
      name: "Conics",
      text: `concept Curve;
// @label 双曲线
concept Hyperbola <: Curve;
concept Point;
op focus(Curve) : set(Point);
op measure(Point) : Real;
op measure(Curve) : Real;`,
    },
  ]);
});
const apply = (
  text: string,
  edits: { start: number; end: number; text: string }[],
) =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      text,
    );

it("adds parent concepts before the selected concept and reuses existing declarations", () => {
  const plan = language.annotate(
    "",
    { kind: "concept", name: "Hyperbola" },
    context,
  );
  const text = apply("", plan.edits);
  expect(text).toBe("concept Curve;\nconcept Hyperbola <: Curve;\n");
  expect(plan.declaration).toBe("concept Hyperbola <: Curve;");
  expect(
    language.annotate(text, { kind: "concept", name: "Curve" }, context).edits,
  ).toEqual([]);
  expect(
    language.annotate(text, { kind: "concept", name: "Hyperbola" }, context)
      .edits,
  ).toEqual([]);
  expect(language.analyze(text, context).issues).toEqual([]);
});
it("includes the complete library parent chain and missing parents of an existing concept", () => {
  const scope = language.context([
    {
      id: "geometry",
      name: "Geometry",
      text: "concept Curve; concept LinearObject <: Curve; concept Line <: LinearObject;",
    },
  ]);
  const source = "concept Line <: LinearObject;\noutput = {};";
  const plan = language.annotate(
    source,
    { kind: "concept", name: "Line" },
    scope,
  );
  const text = apply(source, plan.edits);
  expect(text).toBe(
    "concept Curve;\nconcept LinearObject <: Curve;\nconcept Line <: LinearObject;\noutput = {};",
  );
  expect(
    language.annotate(text, { kind: "concept", name: "Line" }, scope).edits,
  ).toEqual([]);
  expect(language.analyze(text, scope).issues).toEqual([]);
});
it("uses the selected operator overload, includes its concept dependencies and preserves KE", () => {
  const source = "// 已有内容\noutput = {};";
  const plan = language.annotate(
    source,
    { kind: "operator", name: "focus", params: ["Curve"], type: "set{Point}" },
    context,
  );
  const text = apply(source, plan.edits);
  expect(text).toContain("op focus(Curve) : set(Point);");
  expect(text.indexOf("concept Point;")).toBeLessThan(text.indexOf("op focus"));
  expect(text).toContain("// 已有内容");
  expect(text).toContain("output = {};");
  expect(language.analyze(text, context).issues).toEqual([]);
  expect(
    language.annotate(text, { kind: "operator", name: "focus" }, context).edits,
  ).toEqual([]);
  const overload = language.annotate(
    text,
    { kind: "operator", name: "measure", params: ["Point"], type: "Real" },
    context,
  );
  expect(overload.declaration).toBe("op measure(Point) : Real;");
});
it("snaps a selected declaration to boundaries while preserving parent-before-child and use order", () => {
  const source =
    "concept Curve;\nconcept Point;\nconcept Hyperbola <: Curve;\nop focus(Curve) : set(Point);\noutput = {};";
  const start = source.indexOf("Hyperbola");
  const plan = language.moveDeclaration(
    source,
    { start, end: start + 4 },
    0,
    context,
  );
  const text = apply(source, plan.edits);
  expect(text.indexOf("concept Curve")).toBeLessThan(
    text.indexOf("concept Hyperbola"),
  );
  expect(text.indexOf("concept Hyperbola")).toBeLessThan(
    text.indexOf("op focus"),
  );
  expect(language.analyze(text, context).issues).toEqual([]);
  const op = source.indexOf("op focus");
  expect(
    language.moveDeclaration(
      source,
      { start: op, end: op + 2 },
      source.indexOf("set(Point)") + 4,
      context,
    ).edits,
  ).toEqual([]);
  expect(() =>
    language.moveDeclaration(
      source,
      { start: source.indexOf("output"), end: source.length },
      0,
      context,
    ),
  ).toThrow();
});
it("keeps incomplete CO in the domain header without inventing types or executable declarations", async () => {
  const entry: Entry = {
    kind: "operator",
    name: "track",
    label: "轨迹",
    type: "",
    params: [],
  };
  const text = language.renderEntry(entry);
  const header = language.readHeader(text, "test.keh");
  expect(header.issues).toEqual([]);
  expect(header.entries[0]).toMatchObject({ ...entry, draft: true });
  expect(text).toContain("// @draft ");
  expect(header.library.operators.track).toBeUndefined();
  const scope = language.context([{ id: "test", name: "test", text }]);
  const plan = language.annotate(
    "output = {};",
    { kind: "operator", name: "track", params: [] },
    scope,
  );
  expect(plan).toMatchObject({
    edits: [],
    draft: true,
    declaration: "op track() : ",
  });
  expect(
    (await language.inspect("op ", 3, scope)).completions.map((c) => c.name),
  ).not.toContain("track");
  expect(language.analyze("output = {};", scope).issues).toEqual([]);
});
it("replaces a pending CO with its completed signature and makes it available immediately", async () => {
  const draft: Entry = {
    kind: "operator",
    name: "track",
    label: "轨迹",
    type: "",
    params: [{ name: "value", type: "" }],
  };
  let text = "concept Path;\n" + language.renderEntry(draft);
  text = applyLibraryEdits(
    text,
    [
      {
        key: entryKey(draft),
        entry: {
          ...draft,
          type: "Path",
          params: [{ name: "value", type: "Real" }],
        },
      },
    ],
    language,
  );
  const header = language.readHeader(text, "test.keh");
  expect(header.issues).toEqual([]);
  expect(header.entries.find((e) => e.name === "track")?.draft).toBeUndefined();
  expect(text).not.toContain("@draft");
  expect(text).toContain("op track(value : Real) : Path;");
  const scope = language.context([{ id: "test", name: "test", text }]);
  expect(
    (await language.inspect("op ", 3, scope)).completions.map((c) => c.name),
  ).toContain("track");
  const plan = language.annotate(
    "",
    { kind: "operator", name: "track", params: ["Real"] },
    scope,
  );
  expect(apply("", plan.edits)).toContain("concept Path;");
  expect(plan.declaration).toContain("track");
});
it("keeps a pending overload separate and supports a complete zero-argument operator", () => {
  const draft: Entry = {
    kind: "operator",
    name: "measure",
    type: "",
    params: [],
  };
  const text =
    "concept Shape;\nop measure(Shape) : Real;\n" + language.renderEntry(draft);
  const scope = language.context([{ id: "test", name: "test", text }]);
  expect(
    language.annotate(
      "",
      { kind: "operator", name: "measure", params: ["Shape"] },
      scope,
    ),
  ).not.toHaveProperty("draft");
  expect(
    language.annotate(
      "",
      { kind: "operator", name: "measure", params: [] },
      scope,
    ),
  ).toHaveProperty("draft", true);
  const completed = language.renderEntry({
    ...draft,
    name: "origin",
    type: "Real",
  });
  expect(completed).toBe("op origin() : Real;");
  expect(language.readHeader(completed, "test.keh").issues).toEqual([]);
});
it("shows actionable concise diagnostics with an explicit fix for a trailing separator", async () => {
  const source = "concept Real;\noutput = {x | x : Real,\n};";
  const result = await language.inspect(source, 0, context, { enabled: false });
  const issue = result.issues.find((i) => i.code === "syntax")!;
  expect(issue.message).toBe("最后一项后无需 ,");
  expect(issue.detail).toBeTruthy();
  expect(issue.replacement).toBe("");
  expect(
    language.analyze(
      apply(source, [
        { start: issue.start, end: issue.end, text: issue.replacement! },
      ]),
      context,
    ).issues,
  ).toEqual([]);
});
it("spaces colons in generated declarations and fixes an existing tight colon on completion", async () => {
  const source = "x: Re";
  const result = await language.inspect(source, source.length, context, {
    callStyle: "smart",
  });
  const choice = result.completions.find((c) => c.name === "Real");
  expect(choice.edits).toEqual([{ start: 1, end: 1, text: " " }]);
  expect(language.format("x:Real; op measure(Point):Real;", context)).toContain(
    "x : Real;",
  );
});
it("retains local rules for numeric subtypes without confusing compatibility aliases with inheritance", () => {
  const text =
    "concept Number;\nconcept Real <: Number;\nconcept Length <: Real;\nlength : Length;\noutput = {length + length};";
  expect(
    language
      .analyze(text, context)
      .issues.filter((i) => !i.code.startsWith("style")),
  ).toEqual([]);
  const cycle = language.analyze(
    "concept First <: Second; concept Second <: First;",
    context,
  );
  expect(cycle.issues.some((i) => i.code === "inheritance-cycle")).toBe(true);
});
it("requires explicit built-in declarations and the C/O tools supply their dependencies", async () => {
  const source = "x : Number; output = {abs(x)};";
  const issues = language
    .analyze(source, context)
    .issues.filter((i) => i.code === "builtin-declaration");
  expect(issues.map((i) => source.slice(i.start, i.end))).toEqual([
    "Number",
    "abs",
  ]);
  const plan = language.annotate(
    source,
    { kind: "operator", name: "abs", params: ["Number"] },
    context,
  );
  const text = apply(source, plan.edits);
  expect(text).toContain("concept Number;");
  expect(text).toContain("op abs(Number) : Number;");
  expect(language.analyze(text, context).issues).toEqual([]);
  expect(
    language.annotate(
      text,
      { kind: "operator", name: "abs", params: ["Number"] },
      context,
    ).edits,
  ).toEqual([]);
  expect(
    language.analyze(source, { ...context, declareBuiltIns: false }).issues,
  ).toEqual([]);
  expect(
    language.coreEntries.some(
      (e) => e.name === "Number" && e.kind === "concept",
    ),
  ).toBe(true);
  expect(
    (await language.inspect("concept Num", 11, context)).completions.some(
      (c) => c.name === "Number",
    ),
  ).toBe(true);
});
