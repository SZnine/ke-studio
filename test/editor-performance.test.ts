import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { createLanguage } from "../studio/language/index";
import { Store } from "../src/studio/store";
import type { Language, LanguageEngine } from "../src/studio/engine";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  reads: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("../src/studio/preferences", () => ({
  preference: async () => undefined,
}));
vi.mock("../src/studio/files", () => {
  async function readFile(name: string) {
    disk.reads(name);
    const value = disk.files.get(name);
    if (value === undefined)
      throw Object.assign(new Error("Missing"), { code: "ENOENT" });
    return value;
  }
  return {
    path: { join: (...parts: string[]) => parts.join("/") },
    randomUUID: () => crypto.randomUUID(),
    atomic: disk.writes,
    optional: async (name: string) =>
      disk.files.has(name) ? readFile(name) : undefined,
    files: {
      readFile,
      readdir: async (name: string) => {
        disk.reads(name);
        return [
          ...new Set(
            [...disk.files.keys()]
              .filter((key) => key.startsWith(name + "/"))
              .map((key) => key.slice(name.length + 1).split("/")[0]),
          ),
        ];
      },
    },
  };
});
let language: Language;
let store: Store, engine: LanguageEngine;
const put = (path: string, value: unknown) =>
  disk.files.set(path, JSON.stringify(value));
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
beforeEach(() => {
  disk.files.clear();
  disk.reads.mockClear();
  disk.writes.mockClear();
  put("shared/domains.json", [
    { id: "common", name: "通用" },
    { id: "parent", name: "父领域" },
    { id: "child", name: "子领域", parent: "parent" },
    { id: "other", name: "其他领域" },
  ]);
  disk.files.set("shared/libraries/common.keh", "");
  disk.files.set(
    "shared/libraries/parent.keh",
    "concept Shape; op measure(Shape): Real;",
  );
  disk.files.set(
    "shared/libraries/child.keh",
    "concept Point; op locate(Shape): Point;",
  );
  disk.files.set(
    "shared/libraries/other.keh",
    "concept RemoteType; op remote_measure(RemoteType): Real;",
  );
  put("settings/model.json", { baseUrl: "https://example.com", model: "test" });
  put("ke-workspace.json", {
    id: "test",
    activeBank: "default",
    banks: [{ id: "default", name: "题库" }],
  });
  put("banks/default/drafts/child/draft.json", {
    id: "draft",
    number: "草稿",
    ke: "",
    prompt: "",
    notes: "",
    updated: "",
    draft: true,
    coScope: "all",
  });
  engine = {
    active: { service: language, revision: "one", files: {} },
    get service() {
      return engine.active!.service;
    },
    async state() {
      return {
        revision: engine.active!.revision,
        files: {},
        tokenTypes: [],
        editor: { brackets: [], triggers: [] },
      };
    },
  } as unknown as LanguageEngine;
  store = new Store("banks/default", engine);
});
const input = (editorContext: string) => ({
  domain: "child",
  editorContext,
  text: "op ",
  offset: 3,
});
const names = (result: any) => result.completions.map((item: any) => item.name);

it("serves completion without file reads or waiting for an in-flight save", async () => {
  const state = await store.workspace("child");
  disk.reads.mockClear();
  let release!: () => void,
    saving = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pendingSave = store.mutate(async () => {
    await gate;
    saving = false;
  });
  const timeout = setTimeout(release, 1000);
  try {
    const result = await store.inspectEditor(input(state.editorContext));
    expect(saving).toBe(true);
    expect(names(result)).toEqual(
      expect.arrayContaining(["measure", "locate"]),
    );
    expect(disk.reads).not.toHaveBeenCalled();
    expect(disk.writes).not.toHaveBeenCalled();
  } finally {
    clearTimeout(timeout);
    release();
    await pendingSave;
  }
});

it("uses the same prepared CO scope to generate annotation edits without filesystem access", async () => {
  const state = await store.workspace("child");
  disk.reads.mockClear();
  const result = await store.inspectEditor({
    ...input(state.editorContext),
    text: "",
    annotation: { kind: "operator", name: "locate" },
  });
  expect("declaration" in result && result.declaration).toBe(
    "op locate(Shape) : Point;",
  );
  expect(disk.reads).not.toHaveBeenCalled();
  expect(disk.writes).not.toHaveBeenCalled();
});

it("persists evidence with a question and preserves it on unrelated edits", async () => {
  const annotation = {
    id: "evidence",
    start: 0,
    end: 3,
    quote: "曲线C",
    kind: "concept" as const,
    name: "Shape",
    declaration: "concept Shape;",
  };
  const question = await store.questions.prepare(
    "child",
    { number: "01", prompt: "曲线C", annotations: [annotation] },
    true,
  );
  await store.questions.write("child", question);
  const [file, text] = disk.writes.mock.calls.at(-1)!;
  disk.files.set(file, text);
  const edited = await store.questions.prepare("child", {
    id: question.id,
    notes: "补充备注",
  });
  expect(edited.annotations).toEqual([annotation]);
  expect(
    (
      await store.questions.prepare("child", {
        id: question.id,
        prompt: "已修改原文",
      })
    ).annotations,
  ).toEqual([]);
});

it("reuses unchanged CO scopes and replaces them after CO or ranking changes", async () => {
  const prepare = vi.spyOn(store, "context");
  const first = await store.workspace("child");
  expect((await store.workspace("child")).editorContext).toBe(
    first.editorContext,
  );
  expect(prepare).toHaveBeenCalledTimes(1);
  disk.files.set(
    "shared/libraries/parent.keh",
    "concept Shape; op new_measure(Shape): Real;",
  );
  const changed = await store.workspace("child");
  expect(changed.editorContext).not.toBe(first.editorContext);
  const result = names(await store.inspectEditor(input(changed.editorContext)));
  expect(result).toContain("new_measure");
  expect(result).not.toContain("measure");
  put("banks/default/usage/child.json", { locate: 20 });
  expect((await store.workspace("child")).editorContext).not.toBe(
    changed.editorContext,
  );
});

it("switches draft scope and rejects a snapshot from the previous language service", async () => {
  const all = await store.workspace("child", "draft", true);
  expect(names(await store.inspectEditor(input(all.editorContext)))).toContain(
    "remote_measure",
  );
  const draft = JSON.parse(
    disk.files.get("banks/default/drafts/child/draft.json")!,
  );
  put("banks/default/drafts/child/draft.json", { ...draft, coScope: "parent" });
  const limited = await store.workspace("child", "draft", true);
  expect(
    names(await store.inspectEditor(input(limited.editorContext))),
  ).not.toContain("remote_measure");
  const inspect = vi.fn(language.inspect);
  engine.active = {
    service: { ...language, inspect },
    files: {},
    revision: "two",
  };
  const result = await store.inspectEditor({
    ...input(limited.editorContext),
    questionId: "draft",
    draft: true,
  });
  expect(inspect).toHaveBeenCalledOnce();
  expect(result.languageRevision).toBe("two");
});

it("still opens the workbench when a CO file needs repair", async () => {
  disk.files.set("shared/libraries/parent.keh", "op broken(");
  const state = await store.workspace("child");
  expect(state.libraries.find((item) => item.id === "parent")!.text).toBe(
    "op broken(",
  );
  await expect(
    store.inspectEditor(input(state.editorContext)),
  ).rejects.toThrow();
});

it("shares analysis across cursor tools but isolates changed text and CO scopes", async () => {
  const one = language.context([
    { id: "one", name: "One", text: "concept First;" },
  ]);
  const two = language.context([
    { id: "two", name: "Two", text: "concept Second;" },
  ]);
  const text = "value: First;";
  const analysis = language.analyze(text, one);
  await language.inspect(text, 5, one, { enabled: false });
  expect(language.analyze(text, one)).toBe(analysis);
  expect(language.analyze(text + "\n", one)).not.toBe(analysis);
  expect(language.analyze(text, two).symbols.has("First")).toBe(false);
  expect(language.analyze(text, two).symbols.has("Second")).toBe(true);
});
