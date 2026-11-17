import { build } from "esbuild";
import fs from "node:fs/promises";
// Local browser fixture only. The release build clears dist and never includes this page.
await build({
  entryPoints: ["test/browser-smoke.ts"],
  outfile: "dist/browser-smoke.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
});
await fs.writeFile(
  "dist/check.html",
  '<!doctype html><meta charset="utf-8"><title>KE browser checks</title><button>运行浏览器验证</button><pre role="status"></pre><a href="./" hidden>打开隔离验证工作区</a> <script type="module" src="browser-smoke.js"></script>',
);
