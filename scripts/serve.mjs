import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist");
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
http
  .createServer(async (request, response) => {
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
      response.end(await fs.readFile(file));
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  })
  .listen(4331, "127.0.0.1", () =>
    console.log("http://127.0.0.1:4331/ke-studio/"),
  );
