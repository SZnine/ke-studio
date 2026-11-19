import fs from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { createLanguage } from "../studio/language/index";

let language: Awaited<ReturnType<typeof createLanguage>>;

beforeAll(async () => {
  const directory = "studio/language";
  const files = Object.fromEntries(
    await Promise.all(
      (await fs.readdir(directory)).map(async (name) => [
        name,
        await fs.readFile(`${directory}/${name}`, "utf8"),
      ]),
    ),
  );
  language = await createLanguage(files);
});

it("accepts structural tuple types, tuple literals, and aggregate operator signatures", () => {
  const scope = language.context([]);
  const source = `concept Any;
concept Number;
concept NaturalNumber <: Number;
op sum(set(Any), operator) : Number;
op distance(tuple(Number, Number)) : Number;
range : set(tuple(NaturalNumber, NaturalNumber));
range = {(i, j,) | i : NaturalNumber, j : NaturalNumber};
output = sum(range, distance)`;
  const result = language.analyze(source, scope);
  expect(result.issues).toEqual([]);
  expect(result.symbols.get("range")?.type).toBe("set{tuple(NaturalNumber, NaturalNumber)}");
  expect(result.symbols.get("distance")?.params).toEqual(["tuple(Number, Number)"]);
});

it("checks the parts and arity of tuple values passed to operators", () => {
  const scope = language.context([]);
  const header = `concept Animal;
concept Dog <: Animal;
concept Plant;
op pick(tuple(Animal, set(Animal))) : Animal;
dog : Dog;
plant : Plant;
`;
  expect(language.analyze(header + "output = pick((dog, {dog}));", scope).issues).toEqual([]);
  for (const args of ["(dog,)", "(dog, {plant})"]) {
    const issues = language.analyze(header + `output = pick(${args});`, scope).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.code === "type-mismatch")).toBe(true);
  }
});

it("keeps tuple component dependencies when inserting a declaration from CO", () => {
  const library = `concept Point;
concept Segment;
op build(tupleof(Point, set(Point))) : Segment;`;
  const header = language.readHeader(library, "shapes.keh");
  const entry = header.entries.find((item) => item.name === "build")!;
  expect(language.renderEntry(entry)).toBe("op build(arg1 : tuple(Point, set(Point))) : Segment;");
  const scope = language.context([{ id: "shapes", name: "Shapes", text: library }]);
  const result = language.annotate("", { kind: "operator", name: "build" }, scope);
  const document = result.edits.map((edit) => edit.text).join("");
  expect(document).toContain("concept Point;");
  expect(document).toContain("op build(tuple(Point, set(Point))) : Segment;");
  expect(language.analyze(document, scope).issues).toEqual([]);
});

it("accepts cpt, Boolean aliases, and symbolic logic in their original contexts", () => {
  const scope = language.context([]);
  const source = `cpt Bool;
cpt Object;
operator check(Bool) : Bool;
op marked(Object) : Bool;
flagged : Bool;
flagged = TrueConst :- o : Object, ~(marked(o) = True) && marked(o) = False || marked(o) = TRUE, (o : Object || o : Object);
output = check(FalseConst OR FALSE || true)`;
  expect(language.analyze(source, scope).issues).toEqual([]);
});

it("preserves existing tuple operator names and rejects unsupported type constructors", () => {
  const scope = language.context([]);
  const source = `concept Point;
op tuple(Point, Point) : tuple(Point, Point);
a : Point;
output = tuple(a, a);`;
  expect(language.analyze(source, scope).issues).toEqual([]);
  expect(language.analyze("concept Point; op bad(list(Point)) : Point;", scope).issues).toEqual([
    expect.objectContaining({ code: "syntax" }),
  ]);
});

it("rejects a missing statement separator inside a file", () => {
  const scope = language.context([]);
  expect(language.analyze("concept A concept B;", scope).issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "syntax" })]),
  );
});
