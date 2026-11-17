import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
export function createStaticServer(root = path.join(projectRoot, "dist")) {
  return http.createServer(async (request, response) => {
    try {
      let name = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      ).replace(/^\/ke-studio\//, "/");
      const file = path.resolve(
        root,
        "." + (name === "/" ? "/index.html" : name),
      );
      if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
      response.setHeader(
        "Content-Type",
        types[path.extname(file)] || "text/plain",
      );
      response.setHeader("Cache-Control", "no-store");
      const content = await fs.readFile(file);
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}

export async function serve({ port = 4331, open = false } = {}) {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/ke-studio/`;
  console.log(`KE Studio: ${url}\nPress Ctrl+C to stop.`);
  if (open) {
    const command =
      process.platform === "win32"
        ? "explorer.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    spawn(command, [url], { stdio: "ignore", windowsHide: true })
      .on("error", () => {
        console.log("Open the URL above in Edge or Chrome.");
      })
      .unref();
  }
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await serve({ port: Number(process.env.PORT || 4331) });
