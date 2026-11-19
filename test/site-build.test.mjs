import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createStaticServer, projectRoot } from "../scripts/serve.mjs";

test("site serves Pages paths and the prebuilt editor and language worker", async () => {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(base + "/ke-studio/");
    const html = await home.text();
    assert.match(html, /id="choose-folder"/);
    const build = await (await fetch(base + "/ke-studio/build.json")).json();
    assert.match(build.revision, /^[a-f0-9]{12}$/);
    assert.ok(html.includes("./app.css?v=" + build.revision));
    assert.ok(html.includes('cache: "no-store"'));
    assert.ok(html.includes('id="preview-source"'));
    assert.ok(html.includes('id="annotation-links"'));
    assert.ok(html.includes('data-completion-mode="smart"'));
    assert.ok(!html.includes('id="completion-style"'));
    for (const name of [
      "app.js",
      "app.css",
      "workspace.worker.js",
      "editor.worker.js",
      "initial.json",
      "build.json",
    ]) {
      const response = await fetch(
        base + "/ke-studio/" + name + "?v=" + build.revision,
      );
      assert.equal(response.status, 200, name);
      const actual = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual(
        actual,
        new Uint8Array(await fs.readFile(path.join(projectRoot, "dist", name))),
      );
    }
    assert.equal((await fetch(base + "/ke-studio/esbuild.wasm")).status, 404);
    assert.equal(
      (await fetch(base + "/ke-studio/ke-studio-local.zip")).status,
      404,
    );
    const template = await (
      await fetch(base + "/ke-studio/initial.json")
    ).json();
    assert.ok(
      !Object.keys(template).some((name) =>
        name.startsWith("shared/language/"),
      ),
    );
    const font = await fetch(
      base + "/ke-studio/fonts/KaTeX_Main-Regular.woff2",
    );
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal((await fetch(base + "/ke-studio/missing.js")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
