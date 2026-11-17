import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { projectRoot, serve } from "./serve.mjs";

process.chdir(projectRoot);
const exists = (file) =>
  fs.access(path.join(projectRoot, file)).then(
    () => true,
    () => false,
  );
if (!(await exists("dist/index.html"))) {
  // Source checkout: install/build once. The downloaded local package is already built.
  if (!(await exists("node_modules/esbuild/package.json")))
    execSync("npm ci", { stdio: "inherit" });
  execSync("npm run build", { stdio: "inherit" });
}
try {
  await serve({
    port: Number(process.env.PORT || 4340),
    open: !process.argv.includes("--no-open"),
  });
} catch (error) {
  console.error(
    error.code === "EADDRINUSE"
      ? "Port is in use. Close the other local instance, or set PORT to another port."
      : error.message,
  );
  process.exitCode = 1;
}
