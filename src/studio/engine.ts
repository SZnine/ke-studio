import { files as fs, path, atomic } from "./files";
import * as esbuild from "esbuild-wasm";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { LanguageState } from "./language";

export const digest = (files: Record<string, string>) =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(
          Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    ),
  ).slice(0, 16);
let compiler: Promise<void> | undefined;
export type Language = Awaited<
  ReturnType<typeof import("../../studio/language/index").createLanguage>
>;
export interface Compiled {
  service: Language;
  files: Record<string, string>;
  revision: string;
}

/** Compile editable TypeScript and EBNF once per change; all consumers use this instance. */
export class LanguageEngine {
  active?: Compiled;
  error?: string;
  private attempted = "";
  private pending?: Promise<void>;
  private compilation = Promise.resolve();
  onChange?: (
    before: Record<string, string>,
    after: Record<string, string>,
    service: Language,
  ) => Promise<void>;
  constructor(readonly directory = "shared/language") {}
  async sources() {
    const names = (await fs.readdir(this.directory))
      .filter((name) => /\.(ts|langium|keh|json|md)$/.test(name))
      .sort();
    return Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          await fs.readFile(path.join(this.directory, name), "utf8"),
        ]),
      ),
    );
  }
  compile(
    files: Record<string, string>,
    previous = this.active,
  ): Promise<Compiled> {
    const task = this.compilation.then(() =>
      this.compileSources(files, previous),
    );
    this.compilation = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  private async compileSources(
    files: Record<string, string>,
    previous?: Compiled,
  ): Promise<Compiled> {
    const revision = digest(files);
    await (compiler ||= esbuild.initialize({
      wasmURL: new URL("esbuild.wasm", import.meta.url).href,
      worker: false,
    }));
    const result = await esbuild.build({
      stdin: {
        contents: "export { createLanguage } from './index';",
        resolveDir: "/language",
        sourcefile: "entry.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "es2022",

      logLevel: "silent",
      plugins: [
        {
          name: "language-sources",
          setup(builder) {
            builder.onResolve({ filter: /^\.\.\/framework\.mjs$/ }, () => ({
              path: new URL("framework.mjs", import.meta.url).href,
              external: true,
            }));
            builder.onResolve({ filter: /^\.\// }, (args) => ({
              path: args.path.replace(/^\.\//, "").replace(/\.ts$/, "") + ".ts",
              namespace: "language",
            }));
            builder.onLoad({ filter: /.*/, namespace: "language" }, (args) => {
              if (!(args.path in files))
                throw new Error(`语言文件不存在：${args.path}`);
              return { contents: files[args.path], loader: "ts" };
            });
          },
        },
      ],
    });
    const url = URL.createObjectURL(
      new Blob([result.outputFiles[0].text], { type: "text/javascript" }),
    );
    let loaded;
    try {
      loaded = await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const previousCore =
      previous && previous.files["core.keh"] === files["core.keh"]
        ? previous.service.readHeader(files["core.keh"], "core.keh").entries
        : undefined;
    const service: Language = await loaded.createLanguage(files, previousCore);
    files = { ...files, "core.keh": service.coreText };
    return { service, files, revision: digest(files) };
  }
  async refresh() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const files = await this.sources(),
        revision = digest(files);
      if (revision === this.attempted) return;
      this.attempted = revision;
      try {
        const compiled = await this.compile(files);
        if (this.onChange)
          await this.onChange(
            this.active?.files || {},
            compiled.files,
            compiled.service,
          );
        await this.commit(compiled);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  async commit(compiled: Compiled) {
    const current = await this.sources();
    for (const [name, text] of Object.entries(compiled.files))
      if (current[name] !== text)
        await atomic(path.join(this.directory, name), text);
    this.active = compiled;
    this.attempted = compiled.revision;
    this.error = undefined;
  }
  get service() {
    if (!this.active)
      throw new Error(this.error || "语言尚未编译。请在语言页修复源码。");
    return this.active.service;
  }
  async state(): Promise<LanguageState> {
    return {
      revision: this.active?.revision || "",
      version: this.active?.service.manifest.version || "",
      files: await this.sources(),
      error: this.error,
      tokenTypes: this.active?.service.tokenTypes || [],
      editor: this.active?.service.editor || { brackets: [], triggers: [] },
    };
  }
}
