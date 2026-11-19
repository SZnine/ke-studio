import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { compileGrammar } from "../studio/compile-grammar.mjs";
const fingerprint = createHash("sha256");
async function hashSources(folder) {
  for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : 1),
  )) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await hashSources(file);
    else {
      const bytes = await fs.readFile(file);
      fingerprint.update(file.replaceAll(path.sep, "/") + "\0");
      fingerprint.update(
        /\.(woff2?|ttf|png|jpg)$/.test(file)
          ? bytes
          : bytes.toString("utf8").replace(/\r\n/g, "\n"),
      );
    }
  }
}
for (const folder of ["web", "src", "studio", "initial", "scripts"])
  await hashSources(folder);
fingerprint.update(
  (await fs.readFile("package-lock.json", "utf8")).replace(/\r\n/g, "\n"),
);
const revision = fingerprint.digest("hex").slice(0, 12);
const starterNames = {
  geometry: "几何",
  "number-theory": "数论",
  algebra: "代数",
  conics: "圆锥曲线",
};
const starter = await Promise.all(
  Object.entries(starterNames).map(async ([domain, name]) => ({
    id: `seed:${domain}`,
    name,
    domain,
    text: await fs.readFile(`studio/co-seed/${domain}.keh`, "utf8"),
  })),
);
const languageArtifact = {
  ...await compileGrammar(await fs.readFile("studio/language/ke.langium", "utf8")),
  core: await fs.readFile("studio/language/core.keh", "utf8"),
  manifest: await fs.readFile("studio/language/manifest.json", "utf8"),
  starter,
  revision,
};
const shared = {
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  logLevel: "info",
  define: { __KE_BUILD__: JSON.stringify(revision) },
};
const output = path.resolve("dist");
if (output !== path.join(process.cwd(), "dist"))
  throw new Error("Invalid build output");
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const results = await Promise.all([
  build({
    ...shared,
    entryPoints: ["web/studio/app.ts"],
    outfile: "dist/app.js",
    metafile: true,
    loader: { ".ttf": "file", ".woff": "file", ".woff2": "file" },
    assetNames: "fonts/[name]",
  }),
  build({
    ...shared,
    entryPoints: ["src/studio/worker.ts"],
    outfile: "dist/workspace.worker.js",
    metafile: true,
    define: { ...shared.define, __KE_LANGUAGE__: JSON.stringify(languageArtifact) },
  }),
  build({
    ...shared,
    entryPoints: ["node_modules/monaco-editor/esm/vs/editor/editor.worker.js"],
    outfile: "dist/editor.worker.js",
    metafile: true,
  }),
]);
const inputs = results.flatMap((r) => Object.keys(r.metafile.inputs));
for (const feature of [
  "suggestController.js",
  "suggestWidget.js",
  "documentSemanticTokens.js",
])
  if (!inputs.some((name) => name.endsWith("/" + feature)))
    throw new Error("Missing editor feature: " + feature);
const template = {};
async function collect(folder, prefix) {
  for (const file of await fs.readdir(folder, { withFileTypes: true })) {
    const name = path.join(folder, file.name);
    if (file.isDirectory()) await collect(name, prefix + file.name + "/");
    else template[prefix + file.name] = await fs.readFile(name, "utf8");
  }
}
await collect("initial", "");
await fs.writeFile("dist/initial.json", JSON.stringify(template));
await fs.writeFile(
  "dist/index.html",
  (await fs.readFile("web/studio/index.html", "utf8")).replaceAll(
    "__KE_BUILD__",
    revision,
  ),
);
await fs.writeFile("dist/build.json", JSON.stringify({ revision }));
await fs.writeFile("dist/.nojekyll", "");
const packages = new Set(
  inputs
    .map((p) => p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1])
    .filter(Boolean),
);
const notices = [];
for (const pkg of packages)
  for (const name of await fs.readdir("node_modules/" + pkg)) {
    if (/^(license|copying|notice|thirdpartynotices)(\.|$)/i.test(name))
      notices.push(
        `--- ${pkg}/${name} ---\n` +
          (await fs.readFile(`node_modules/${pkg}/${name}`, "utf8")),
      );
  }
notices.push(await fs.readFile("web/studio/fonts/OFL.txt", "utf8"));
await fs.writeFile("dist/THIRD-PARTY-NOTICES.txt", notices.join("\n\n"));
