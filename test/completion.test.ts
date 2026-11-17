import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { createLanguage } from "../studio/language/index";
import type { Language } from "../src/studio/engine";
import type { CompletionOptions } from "../studio/language/editor";
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
const library = `concept Shape; concept Point; concept Angle; concept Set;
op midpoint(Point, Point): Point;
op length(Point, Point): Real;
op angle(Point, Point, Point): Angle;
op unrelated_date(Real): Real;
op real_measure(Shape): Real;`;
async function inspect(text: string, options: CompletionOptions = {}) {
  const offset = text.indexOf("§");
  return language.inspect(
    text.replace("§", ""),
    offset,
    language.context([{ id: "test", name: "Test", text: library }]),
    options,
  );
}
async function complete(text: string, manual = false) {
  return (await inspect(text, { manual })).completions;
}
async function smart(text: string) {
  return (await inspect(text, { callStyle: "smart" })).completions;
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
    expect(concepts.every((c) => c.insert.endsWith(";\n"))).toBe(true);
    const operators = await complete("op §");
    expect(operators.every((c) => c.kind === "operator")).toBe(true);
    expect(operators.map((c) => c.name)).not.toContain("get_year");
    expect(operators.find((c) => c.name === "length").insert).toMatch(/;\n$/);
  });
  it("keeps types out of expression choices and hides unrelated global operators", async () => {
    const result = await complete(
      declarations + "output = { M | § A: Point, B: Point, M: Point };",
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
  const bindings = `concept Number; concept Real;
op sqrt(Number): Number;
output = { (x1,x2,x3) | x1: set(Real), x2: set(Real), `;
  it("prioritizes the set constructor and inserts its editable type slot once", async () => {
    const result = await complete(bindings + "x2: set§ };");
    expect(result[0].name).toBe("set");
    expect(result[0].insert).toBe("set($0)");
    expect(result[0].snippet).toBe(true);
    const existing = await complete(bindings + "x2: set§(Real) };");
    expect(existing[0].insert).toBe("set");
  });
  it("offers types inside set even while bindings or the surrounding input are incomplete", async () => {
    for (const tail of [
      "x2: set(§)",
      "x2: set(Re§)",
      "x2: set(Real§)",
      "x2: set(set(§))",
    ]) {
      const result = await complete(bindings + tail + " };");
      expect(result.map((c) => c.name)).toContain("Real");
      expect(
        result.every(
          (c) => c.kind === "type" || c.name === "set" || c.name === "operator",
        ),
      ).toBe(true);
      expect(result.map((c) => c.name)).not.toEqual(
        expect.arrayContaining(["x1", "sqrt", "real_measure"]),
      );
    }
  });
  it("keeps blank clause separators quiet while manual and argument completion remain available", async () => {
    const text = bindings + "x2: set(Real),§ };";
    expect(await complete(text)).toEqual([]);
    expect((await complete(text, true)).map((c) => c.name)).toContain("x1");
    expect((await complete(bindings + "x§ };")).map((c) => c.name)).toContain(
      "x1",
    );
    const argument = await complete(
      declarations +
        "output = { M | A: Point, B: Point, M: Point, length(A, §) = 1 };",
    );
    expect(argument.map((c) => c.name)).toContain("B");
    expect(argument.every((c) => c.kind !== "type")).toBe(true);
  });
  it("completes CO declarations with input and output types, including a partially written return type", async () => {
    const declaration = (await smart("op mid§")).find(
      (c) => c.name === "midpoint",
    );
    expect(declaration?.insert).toBe("midpoint(Point, Point) : Point;\n");
    const range = await smart("op midpoint(Point, Point): §");
    expect(range[0].insert).toBe("Point;\n");
    expect((await smart("op midpoint(Point, Point): Po§;"))[0].insert).toBe(
      "Point",
    );
    const parameter = (await smart("op midpoint(§): Point;"))[0];
    expect(parameter.name).toBe("Point");
    expect(parameter.detail).toBe("CO 参数类型");
  });
  it("inserts call argument slots and filters each slot by the declared parameter type", async () => {
    const text =
      declarations + "output = { M | A: Point, B: Point, M: Point, M = ";
    const call = (await smart(text + "mid§ };")).find(
      (c) => c.name === "midpoint",
    );
    expect(call?.insert).toBe("midpoint(${1}, ${2})");
    expect(call?.suggest).toBe(true);
    expect(
      (await smart(text + "mid§(A, B) };")).find((c) => c.name === "midpoint")
        ?.insert,
    ).toBe("midpoint");
    const first = await smart(text + "midpoint(§) };");
    expect(first.find((c) => c.name === "A")?.insert).toBe("A, ");
    expect(first.map((c) => c.name)).not.toContain("__GivenAC");
    expect(
      (await smart(text + "midpoint(A§, B) };")).find((c) => c.name === "A")
        ?.insert,
    ).toBe("A");
    expect(
      (await smart(text + "midpoint(A, B§) };")).find((c) => c.name === "B")
        ?.insert,
    ).toBe("B");
  });
  it("offers missing output bindings instead of unrelated variables at the next clause", async () => {
    const result = await smart(bindings + "§ };");
    expect(result.map((c) => c.name)).toEqual(["x3"]);
    expect(result[0].insert).toBe("x3 : ${1}$0");
    const inferred = await smart(
      declarations + "output = { midpoint(A, B) | A: Point, § };",
    );
    expect(inferred[0].name).toBe("B");
    expect(inferred[0].insert).toBe("B : ${1:Point}$0");
    expect(await smart(declarations + "output = { A | A: Point, § };")).toEqual(
      [],
    );
  });
  it("continues completed clauses on Enter without duplicating commas or editing incomplete calls", async () => {
    for (const tail of ["A: Point", "A = midpoint(A, B)", "length(A, B) = 1"]) {
      const text = declarations + "output = { A | " + tail + "\n  § };";
      const result = await inspect(text, {
        callStyle: "smart",
        onEnter: true,
        enabled: false,
      });
      expect(result.continuationEdits).toEqual([
        { start: text.indexOf("\n  §"), end: text.indexOf("\n  §"), text: "," },
      ]);
    }
    for (const tail of [
      "A: Point,",
      "A = midpoint(A,",
      "A: set(",
      "A: Point\n",
      "// comment",
    ]) {
      const text = declarations + "output = { A | " + tail + "\n  § };";
      expect(
        (await inspect(text, { callStyle: "smart", onEnter: true }))
          .continuationEdits,
        tail,
      ).toEqual([]);
    }
    expect(
      (
        await inspect(declarations + "\n§", {
          callStyle: "smart",
          onEnter: true,
        })
      ).continuationEdits,
    ).toEqual([]);
    expect(
      (
        await inspect("output = { A | A: Real\n§ };", {
          callStyle: "name",
          onEnter: true,
        })
      ).continuationEdits,
    ).toEqual([]);
  });
});
