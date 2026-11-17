import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { projectRoot } from "./serve.mjs";

// Read-only service benchmark. Browser rendering and its filesystem IPC are not measured.
const workspace = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/benchmark-editor.mjs <workspace> [completion-name]",
  );
const temporary = path.join(projectRoot, ".tmp");
await fs.mkdir(temporary, { recursive: true });
const output = path.join(temporary, "benchmark-editor.mjs");
await build({
  stdin: {
    contents: `export { mount } from './src/studio/files';
export { Store } from './src/studio/store';
export { LanguageEngine } from './src/studio/engine';
export { createLanguage } from ${JSON.stringify(path.join(workspace, "shared/language/index.ts"))};`,
    resolveDir: projectRoot,
    loader: "ts",
  },
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "benchmark-platform",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/framework\.mjs$/ }, () => ({
          path: path.join(projectRoot, "src/studio/framework.ts"),
        }));
        builder.onResolve({ filter: /^\.\/preferences$/ }, () => ({
          path: "preferences",
          namespace: "benchmark",
        }));
        builder.onLoad({ filter: /.*/, namespace: "benchmark" }, () => ({
          contents:
            "export async function preference(){}; export async function savePreference(){throw new Error('Read only')}",
          loader: "js",
        }));
      },
    },
  ],
});
const { mount, Store, LanguageEngine, createLanguage } = await import(
  pathToFileURL(output)
);
let reads = 0;
function handle(folder) {
  const missing = (error) => {
    if (error.code === "ENOENT")
      throw new DOMException("Missing file", "NotFoundError");
    throw error;
  };
  return {
    name: path.basename(folder),
    async getDirectoryHandle(name) {
      const target = path.join(folder, name);
      if (!(await fs.stat(target).catch(missing)).isDirectory())
        throw new Error("Not a directory");
      return handle(target);
    },
    async getFileHandle(name) {
      const target = path.join(folder, name);
      await fs.access(target).catch(missing);
      return {
        async getFile() {
          return {
            async text() {
              reads++;
              return fs.readFile(target, "utf8");
            },
          };
        },
      };
    },
    async *keys() {
      yield* await fs.readdir(folder).catch(missing);
    },
  };
}
mount(handle(workspace));
const metadata = JSON.parse(
  await fs.readFile(path.join(workspace, "ke-workspace.json"), "utf8"),
);
const files = Object.fromEntries(
  await Promise.all(
    (await fs.readdir(path.join(workspace, "shared/language"))).map(
      async (name) => [
        name,
        await fs.readFile(
          path.join(workspace, "shared/language", name),
          "utf8",
        ),
      ],
    ),
  ),
);
const language = await createLanguage(files);
const engine = new LanguageEngine();
engine.active = { service: language, files, revision: "benchmark" };
const store = new Store(
  "banks/" + metadata.activeBank,
  engine,
  metadata.id,
  path.basename(workspace),
);
const candidates = [];
for (const domain of await store.domains())
  for (const collection of [store.questions, store.drafts]) {
    for (const question of await collection.list(domain.id))
      candidates.push({ domain, question });
  }
const selected = candidates.sort(
  (a, b) => b.question.ke.length - a.question.ke.length,
)[0];
if (!selected) throw new Error("No questions or drafts to benchmark.");
const { domain, question } = selected;
const state = await store.workspace(domain.id, question.id, !!question.draft);
const elapsed = [],
  fileReads = [];
const name =
  process.argv[3] ||
  state.libraries
    .flatMap((library) => library.entries)
    .find((entry) => entry.kind === "concept")?.name ||
  "Concept";
const prefixes = Array.from({ length: name.length }, (_, i) =>
  name.slice(0, i + 1),
);
for (let i = 0; i < 33; i++) {
  const text = question.ke + "\nconcept " + prefixes[i % prefixes.length];
  const input = {
    domain: domain.id,
    questionId: question.id,
    draft: !!question.draft,
    text,
    offset: text.length,
    completion: { manual: true },
    editorContext: state.editorContext,
  };
  reads = 0;
  const start = performance.now();
  await store.inspectEditor(input);
  if (i >= 3) {
    elapsed.push(performance.now() - start);
    fileReads.push(reads);
  }
}
elapsed.sort((a, b) => a - b);
const result = {
  samples: elapsed.length,
  characters: question.ke.length,
  libraryCharacters: state.libraries.reduce(
    (n, library) => n + library.text.length,
    0,
  ),
  medianMs: +elapsed[Math.floor(elapsed.length * 0.5)].toFixed(2),
  p95Ms: +elapsed[Math.ceil(elapsed.length * 0.95) - 1].toFixed(2),
  readsPerRequest: Math.max(...fileReads),
};
await fs.writeFile(
  path.join(temporary, "editor-benchmark.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
