import fs from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { coSignature } from "../src/studio/co-catalog";
import { createLanguage } from "../studio/language/index";
import { typeParts } from "../studio/language/types";

let language: Awaited<ReturnType<typeof createLanguage>>;

beforeAll(async () => {
  const files = await Promise.all(
    ["ke.langium", "core.keh", "manifest.json"].map(async (name) => [
      name,
      await fs.readFile(`studio/language/${name}`, "utf8"),
    ]),
  );
  language = await createLanguage(Object.fromEntries(files));
});

it("recognizes whole Unicode identifiers before matching keyword prefixes", () => {
  const text =
    "concept concept曲线; op opposite_side(concept曲线) : concept曲线;";
  const header = language.readHeader(text, "prefix.keh");
  expect(header.issues).toEqual([]);
  expect(header.entries.map(({ name }) => name)).toEqual([
    "concept曲线",
    "opposite_side",
  ]);
  expect(language.readHeader("concept op;", "keyword.keh").issues).not.toEqual(
    [],
  );
});

it.each([
  ["conics", 113],
  ["algebra", 92],
  ["geometry", 147],
  ["number-theory", 30],
] as const)(
  "keeps %s seed definitions valid and deduplicated by signature",
  async (domain, count) => {
    const current = await fs.readFile(
      "initial/shared/libraries/default.keh",
      "utf8",
    );
    const existing = [
      ...language.coreEntries,
      ...language.readHeader(current, "default.keh").entries,
    ];
    const seed = await fs.readFile(`studio/co-seed/${domain}.keh`, "utf8");
    const { entries, issues } = language.readHeader(seed, `${domain}.keh`);
    // Conflicting author signatures are catalog records. They are loaded as independent declarations.
    expect(issues.every(({ code }) => code === "library")).toBe(true);
    expect(entries).toHaveLength(count);
    const keys = new Set(entries.map(coSignature));
    expect(keys.size).toBe(count);
    expect(existing.some((entry) => keys.has(coSignature(entry)))).toBe(false);
    const types = new Set(
      [...existing, ...entries]
        .filter(({ kind }) => kind === "concept")
        .map(({ name }) => name),
    );
    const defined = (name: string): boolean =>
      name === "operator" ||
      types.has(name) ||
      (typeParts(name)?.every(defined) ?? false);
    for (const entry of entries) {
      expect(["concept", "operator"]).toContain(entry.kind);
      expect(
        [
          entry.type,
          ...entry.params.map(({ type }) => type),
          ...(entry.parent ? [entry.parent] : []),
        ].every(defined),
      ).toBe(true);
      const single = language.readHeader(
        language.renderEntry(entry),
        "one.keh",
      );
      expect(single.issues).toEqual([]);
      expect(single.entries.map(coSignature)).toEqual([coSignature(entry)]);
    }
  },
);
