import { watch } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { projectRoot, serve } from "./serve.mjs";

function build() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      console.error(error.message);
      resolve(false);
    });
    child.once("exit", (code) => resolve(code === 0));
  });
}
if (!(await build())) process.exit(1);
await serve({ port: Number(process.env.PORT || 4331) });
let timer,
  running = false,
  dirty = false;
async function rebuild() {
  dirty = true;
  if (running) return;
  running = true;
  while (dirty) {
    dirty = false;
    if (await build())
      console.log("Rebuilt. Refresh the browser to see your changes.");
  }
  running = false;
}
for (const directory of ["src", "web", "studio", "initial"])
  watch(path.join(projectRoot, directory), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
console.log("Watching src, web, studio and initial. Save a file to rebuild.");
