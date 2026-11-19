import { createLanguageFromCompiled } from "../../studio/language/index";
import type { LanguageState, StarterLibrary } from "./language";

type LanguageArtifact = Parameters<typeof createLanguageFromCompiled>[0] & {
  revision: string;
  starter?: (Omit<StarterLibrary, "entries"> & { text: string })[];
};
declare const __KE_LANGUAGE__: LanguageArtifact;

export type Language = ReturnType<typeof createLanguageFromCompiled>;
export interface LoadedLanguage {
  revision: string;
  service: Language;
  starterLibraries?: StarterLibrary[];
}

let published: LoadedLanguage | undefined;

/** Reuse the published language across banks in this worker. */
export class LanguageEngine {
  active?: LoadedLanguage;

  load() {
    if (!published) {
      const artifact = __KE_LANGUAGE__;
      const service = createLanguageFromCompiled(artifact);
      published = {
        revision: artifact.revision,
        service,
        starterLibraries: (artifact.starter ?? []).map(
          ({ text, ...source }) => ({
            ...source,
            entries: service
              .readHeader(text, source.id)
              .entries.map(({ span, ...entry }) => entry),
          }),
        ),
      };
    }
    this.active = published;
  }

  get service() {
    if (!this.active) throw new Error("语言尚未就绪。");
    return this.active.service;
  }

  state(): LanguageState {
    const { manifest, tokenTypes, editor } = this.service;
    return {
      revision: this.active!.revision,
      version: manifest.version,
      tokenTypes,
      editor,
    };
  }
}
