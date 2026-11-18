import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  languageFingerprint,
  planLanguageDefaults,
} from "../src/studio/language-defaults";

it("uses the same UTF-8 Git fingerprint on Windows and Linux", () => {
  const text = "// 语法\nconst value = 1;\n";
  const git = createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
  expect(languageFingerprint(text.replaceAll("\n", "\r\n"))).toBe(git);
});
it("updates recognized old defaults, adds new modules and preserves unknown local changes", () => {
  const published = {
    files: {
      "semantic.ts": "fixed",
      "profile.ts": "default",
      "new.ts": "new module",
    },
    known: {
      "semantic.ts": [languageFingerprint("old\n")],
      "profile.ts": [languageFingerprint("old default")],
    },
  };
  const plan = planLanguageDefaults(
    { "semantic.ts": "old\r\n", "profile.ts": "my own rule" },
    published,
  );
  expect(plan.changes).toEqual({
    "semantic.ts": "fixed",
    "new.ts": "new module",
  });
  expect(plan.customized).toEqual(["profile.ts"]);
});
it("preserves deliberate restores and deletions after the workspace has an update baseline", () => {
  const published = {
    files: { "semantic.ts": "fixed", "profile.ts": "default" },
    known: { "semantic.ts": [languageFingerprint("old")], "profile.ts": [] },
  };
  const first = planLanguageDefaults(
    { "semantic.ts": "old", "profile.ts": "default" },
    published,
  );
  const reopened = planLanguageDefaults(
    { "semantic.ts": "fixed", "profile.ts": "default" },
    published,
    first.baseline,
  );
  expect(reopened.changes).toEqual({});
  const restored = planLanguageDefaults(
    { "semantic.ts": "old" },
    published,
    first.baseline,
  );
  expect(restored.changes).toEqual({});
  expect(restored.customized).toEqual(["semantic.ts", "profile.ts"]);
});
