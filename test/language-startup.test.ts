import fs from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageEngine } from "../src/studio/engine";
import { compileGrammar } from "../studio/compile-grammar.mjs";

afterEach(() => vi.unstubAllGlobals());

it("loads the compiled language once and reuses it across banks", async () => {
  const [grammar, core, manifest] = await Promise.all(
    ["ke.langium", "core.keh", "manifest.json"].map((file) =>
      fs.readFile(`studio/language/${file}`, "utf8"),
    ),
  );
  vi.stubGlobal("__KE_LANGUAGE__", {
    ...await compileGrammar(grammar),
    core,
    manifest,
    revision: "compiled-test",
  });

  const first = new LanguageEngine();
  first.load();
  const second = new LanguageEngine();
  second.load();

  expect(second.service).toBe(first.service);
  expect(first.state()).toMatchObject({ revision: "compiled-test", version: JSON.parse(manifest).version });
  expect(first.service.analyze("concept Shape;", first.service.context([])).issues).toEqual([]);
});
