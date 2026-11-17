import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { projectRoot } from "./serve.mjs";

const contents = {};
async function include(folder, prefix) {
  for (const file of await fs.readdir(folder, { withFileTypes: true })) {
    const name = path.join(folder, file.name);
    if (file.isDirectory()) await include(name, prefix + file.name + "/");
    else contents[prefix + file.name] = new Uint8Array(await fs.readFile(name));
  }
}
await include(path.join(projectRoot, "dist"), "dist/");
for (const name of [
  "start.cmd",
  "scripts/start.mjs",
  "scripts/serve.mjs",
  "LICENSE",
])
  contents[name] = new Uint8Array(
    await fs.readFile(path.join(projectRoot, name)),
  );
contents["README.md"] = new Uint8Array(
  await fs.readFile(path.join(projectRoot, "docs/local.md")),
);
const { name, version, engines } = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
);
contents["package.json"] = new TextEncoder().encode(
  JSON.stringify(
    {
      name,
      version,
      private: true,
      type: "module",
      engines,
      scripts: { start: "node scripts/start.mjs" },
    },
    null,
    2,
  ),
);
const directory = path.join(projectRoot, "release");
await fs.mkdir(directory, { recursive: true });
const output = path.join(directory, "ke-studio-local.zip");
await fs.writeFile(output, zipSync(contents, { level: 6 }));
console.log(`Local package: ${output}`);
