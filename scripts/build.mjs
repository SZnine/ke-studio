import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const shared = {
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  logLevel: "info",
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
    loader: { ".ttf": "file", ".woff": "file" },
    assetNames: "fonts/[name]",
  }),
  build({
    ...shared,
    entryPoints: ["src/studio/worker.ts"],
    outfile: "dist/workspace.worker.js",
    metafile: true,
  }),
  build({
    ...shared,
    entryPoints: ["src/studio/framework.ts"],
    outfile: "dist/framework.mjs",
    metafile: true,
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
await collect("initial/shared", "shared/");
await collect("studio/language", "shared/language/");
await fs.writeFile("dist/initial.json", JSON.stringify(template));
await fs.copyFile(
  "node_modules/esbuild-wasm/esbuild.wasm",
  "dist/esbuild.wasm",
);
await fs.copyFile("web/studio/index.html", "dist/index.html");
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
