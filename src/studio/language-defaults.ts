import { sha1 } from "@noble/hashes/sha1";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";

export interface PublishedLanguage {
  files: Record<string, string>;
  known: Record<string, string[]>;
}
export interface LanguageUpdate {
  updated: string[];
  customized: string[];
  error?: string;
}
export function languageFingerprint(text: string) {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
  return bytesToHex(
    sha1(
      concatBytes(new TextEncoder().encode(`blob ${bytes.length}\0`), bytes),
    ),
  );
}

/** Upgrade untouched defaults; edits and deliberate restores remain owned by this workspace. */
export function planLanguageDefaults(
  current: Record<string, string>,
  published: PublishedLanguage,
  previous?: Record<string, string>,
) {
  const changes: Record<string, string> = {},
    baseline: Record<string, string> = {};
  const customized: string[] = [];
  for (const [name, text] of Object.entries(published.files)) {
    const next = languageFingerprint(text);
    baseline[name] = next;
    const before = current[name];
    if (before === undefined && previous?.[name]) {
      customized.push(name);
      continue;
    }
    if (before !== undefined) {
      const hash = languageFingerprint(before);
      if (hash === next) continue;
      const managed = previous?.[name]
        ? hash === previous[name]
        : published.known[name]?.includes(hash);
      if (!managed) {
        customized.push(name);
        continue;
      }
    }
    changes[name] = text;
  }
  return { changes, baseline, customized };
}
