import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { createLanguage } from "../studio/language/index";
import type { Language } from "../src/studio/engine";
let language: Language;
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
});
const library = `concept Shape; concept Point; concept Angle;
op midpoint(Point, Point): Point;
op length(Point, Point): Real;
op angle(Point, Point, Point): Angle;
op unrelated_date(Real): Real;`;
async function complete(text: string, manual = false) {
  const offset = text.indexOf("§");
  return (
    await language.inspect(
      text.replace("§", ""),
      offset,
      language.context([{ id: "test", name: "Test", text: library }]),
      { manual },
    )
  ).completions;
}
const declarations = `concept Point; concept Angle;
op midpoint(Point, Point): Point;
op length(Point, Point): Real;
__GivenAC: Real;
__RightAngle: Angle;
`;
describe("Contextual completion", () => {
  it("offers declaration entries rather than library symbols at a new statement", async () => {
    const result = await complete("concept Shape;\nc§");
    expect(result.map((c) => c.name)).toEqual(["concept", "const"]);
    const blank = await complete("concept Shape;\n§");
    expect(blank.every((c) => c.kind === "keyword")).toBe(true);
    expect(blank.map((c) => c.name)).toContain("op");
    expect(blank.map((c) => c.name)).not.toContain("operator");
  });
  it("only offers concepts or operators after their respective keyword, ending the declaration once", async () => {
    const concepts = await complete("concept Shape;\nconcept §");
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.every((c) => c.kind === "type")).toBe(true);
    expect(concepts.map((c) => c.name)).not.toContain("Shape");
    expect(concepts.every((c) => c.insert.endsWith(";"))).toBe(true);
    const operators = await complete("op §");
    expect(operators.every((c) => c.kind === "operator")).toBe(true);
    expect(operators.map((c) => c.name)).not.toContain("get_year");
    expect(operators.find((c) => c.name === "length").insert).toMatch(/;$/);
  });
  it("keeps types out of expression choices and hides unrelated global operators", async () => {
    const result = await complete(
      declarations + "output = { M | A: Point, B: Point, M: Point, § };",
    );
    expect(result.map((c) => c.name)).toEqual(
      expect.arrayContaining(["A", "B", "M", "midpoint", "length"]),
    );
    expect(result.every((c) => c.kind !== "type")).toBe(true);
    expect(result.map((c) => c.name)).not.toContain("unrelated_date");
    expect(result.map((c) => c.name)).not.toContain("get_year");
  });
  it("filters a right-hand side using the bound variable type", async () => {
    const result = await complete(
      declarations + "output = { M | A: Point, B: Point, M: Point, M = § };",
    );
    expect(result.map((c) => c.name)).toContain("midpoint");
    expect(result.map((c) => c.name)).not.toContain("length");
    expect(result.map((c) => c.name)).not.toContain("__GivenAC");
  });
  it("does not show a long menu after arithmetic, while explicit completion remains available", async () => {
    const source =
      declarations +
      "output = { M | A: Point, B: Point, M: Point, length(A, B) / § };";
    expect(await complete(source)).toEqual([]);
    const manual = await complete(source, true);
    expect(manual.map((c) => c.name)).toContain("__GivenAC");
    expect(manual.map((c) => c.name)).not.toContain("__RightAngle");
  });
  it("still finds explicitly typed library names and pinyin", async () => {
    const result = await complete(
      declarations + "output = { M | M: Point, unr§ };",
    );
    expect(result.map((c) => c.name)).toContain("unrelated_date");
    const context = language.context([
      { id: "test", name: "Test", text: "// @label 点\nconcept Point;" },
    ]);
    const text = "concept dian";
    const completion = await language.inspect(text, text.length, context, {});
    expect(completion.completions.map((c) => c.name)).toContain("Point");
  });
});
