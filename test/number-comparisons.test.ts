import fs from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { createLanguage } from "../studio/language/index";

let language: Awaited<ReturnType<typeof createLanguage>>;
let context: ReturnType<typeof language.context>;
beforeAll(async () => {
  const entries = await Promise.all(
    ["ke.langium", "core.keh", "manifest.json"].map(async (name) => [
      name,
      await fs.readFile("studio/language/" + name, "utf8"),
    ]),
  );
  language = await createLanguage(Object.fromEntries(entries));
  context = language.context([]);
});

const declarations = `concept Number;
concept Real <: Number;
concept NaturalNumber <: Number;
concept WholeCount <: NaturalNumber;
concept SignedInteger <: Number;
concept String;
op takes_count(WholeCount) : WholeCount;
whole : WholeCount;
fractional : Real;
integer : SignedInteger;
label : String;
`;

it("accepts ordering of different Number subtypes, aliases and numeric literals", () => {
  const text = declarations + "whole < fractional; integer >= whole; whole > 2; 2 <= whole;";
  expect(language.analyze(text, context).issues).toEqual([]);
});

it("infers mixed numeric arithmetic without narrowing the right operand to the left", () => {
  const text = declarations + "output = whole + integer; whole ^ 2 <= fractional * 3;";
  const result = language.analyze(text, context);
  expect(result.issues).toEqual([]);
  const addition = [...result.types].find(([expr]) => expr.kind === "binary" && expr.op === "+");
  expect(addition?.[1]).toBe("Number");
});

it("still checks numeric operands and assignment and call compatibility", () => {
  const text = declarations + "whole < label; whole = fractional; whole = takes_count(integer);";
  const issues = language.analyze(text, context).issues;
  expect(issues.map(({ code, start, end }) => [code, text.slice(start, end)])).toEqual([
    ["numeric", "label"],
    ["type-mismatch", "fractional"],
    ["type-mismatch", "integer"],
  ]);
});

it("preserves contextual quantity typing in an ordering expression", () => {
  const text = `concept Number;
concept Concept;
concept Distance;
op unit(Number, Concept) : Concept;
__meter : Concept;
distance : Distance;
distance < unit(2, __meter);`;
  expect(language.analyze(text, context).issues).toEqual([]);
});

it("offers numeric siblings in ordering completions and filters nonnumeric values", async () => {
  const text = declarations + "whole < ;";
  const offset = text.lastIndexOf(";");
  const result = await language.inspect(text, offset, context, { manual: true });
  const choices = result.completions.map((choice) => choice.name);
  expect(choices).toContain("fractional");
  expect(choices).toContain("integer");
  expect(choices).not.toContain("label");
});
