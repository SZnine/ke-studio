import { beforeAll, expect, it } from "vitest";
import fs from "node:fs/promises";
import { createLanguage } from "../studio/language/index";
import type { Language } from "../src/studio/engine";
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
it("creates a named instance and optional value without duplicating an existing name", () => {
  const plan = language.annotate(
    "",
    { kind: "var", name: "C", type: "Hyperbola" },
    context,
  );
  const text = apply("", plan.edits);
  expect(text).toContain("C : Hyperbola;");
  expect(text.indexOf("concept Hyperbola")).toBeLessThan(text.indexOf("C :"));
  expect(
    language.annotate(
      text,
      { kind: "var", name: "C", type: "Hyperbola" },
      context,
    ).edits,
  ).toEqual([]);
  expect(() =>
    language.annotate(text, { kind: "var", name: "C", type: "Point" }, context),
  ).toThrow("不同声明");
  const number = language.annotate(
    "",
    { kind: "var", name: "r", type: "Real", value: "1.5" },
    context,
  );
  expect(number.declaration).toBe("r : Real = 1.5;");
  expect(() =>
    language.annotate("", { kind: "var", name: "C;", type: "Point" }, context),
  ).toThrow();
  expect(() =>
    language.annotate(
      "",
      { kind: "var", name: "r", type: "Real", value: "1; x : Real" },
      context,
    ),
  ).toThrow();
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
it("shows actionable concise diagnostics with an explicit fix for a trailing separator", async () => {
  const source = "output = {x | x : Real,\n};";
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
