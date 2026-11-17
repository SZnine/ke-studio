import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { unzipSync } from "fflate";
import { createStaticServer, projectRoot } from "../scripts/serve.mjs";

test("local server serves Pages paths, editor assets and WASM from the build", async () => {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(base + "/ke-studio/");
    assert.match(await home.text(), /id="choose-folder"/);
    for (const name of [
      "app.js",
      "app.css",
      "workspace.worker.js",
      "editor.worker.js",
      "framework.mjs",
      "initial.json",
      "esbuild.wasm",
    ]) {
      const response = await fetch(base + "/ke-studio/" + name);
      assert.equal(response.status, 200, name);
      const actual = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual(
        actual,
        new Uint8Array(await fs.readFile(path.join(projectRoot, "dist", name))),
      );
    }
    const head = await fetch(base + "/ke-studio/esbuild.wasm", {
      method: "HEAD",
    });
    assert.equal(head.headers.get("content-type"), "application/wasm");
    assert.equal(await head.text(), "");
    assert.equal((await fetch(base + "/ke-studio/missing.js")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test(
  "downloaded local package starts without npm dependencies or a project working directory",
  { timeout: 20000 },
  async () => {
    const archive = unzipSync(
      new Uint8Array(
        await fs.readFile(
          path.join(projectRoot, "release/ke-studio-local.zip"),
        ),
      ),
    );
    assert.ok(archive["start.cmd"]);
    assert.ok(archive["dist/THIRD-PARTY-NOTICES.txt"]);
    assert.equal(
      Object.keys(archive).some((name) =>
        /^(node_modules|banks|shared|settings|trash)\//.test(name),
      ),
      false,
    );
    assert.equal(
      Object.keys(archive).some((name) =>
        /(?:check.html|browser-smoke.js)$/.test(name),
      ),
      false,
    );
    const template = JSON.parse(
      new TextDecoder().decode(archive["dist/initial.json"]),
    );
    assert.ok(
      Object.keys(template).every((name) => name.startsWith("shared/")),
    );
    const temporaryRoot = path.join(projectRoot, ".tmp");
    await fs.mkdir(temporaryRoot, { recursive: true });
    const directory = await fs.mkdtemp(
      path.join(temporaryRoot, "local-package-"),
    );
    let child;
    try {
      for (const [name, bytes] of Object.entries(archive)) {
        const file = path.resolve(directory, name);
        assert.ok(file.startsWith(directory + path.sep));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
      }
      child = spawn(
        process.execPath,
        [path.join(directory, "scripts/start.mjs"), "--no-open"],
        {
          cwd: temporaryRoot,
          env: { ...process.env, PORT: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const url = await new Promise((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => reject(new Error("Local package did not start: " + output)),
          10000,
        );
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Local package exited (${code}): ${output}`));
        });
        child.stderr.on("data", (data) => (output += data));
        child.stdout.on("data", (data) => {
          output += data;
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/ke-studio\//);
          if (match) {
            clearTimeout(timeout);
            resolve(match[0]);
          }
        });
      });
      assert.match(await (await fetch(url)).text(), /KE Studio/);
    } finally {
      if (child && child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
      assert.equal(path.dirname(directory), temporaryRoot);
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
