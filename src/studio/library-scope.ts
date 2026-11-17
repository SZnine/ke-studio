import type { Language } from "./engine";
/** Lexical scope: a nearer domain owns a name, including all of that operator's overloads. */
export function scopedSources<
  T extends { id: string; name: string; text: string },
>(language: Language, sources: T[]): T[] {
  const owned = new Set<string>();
  return [...sources]
    .reverse()
    .map((source) => {
      const parsed = language.readHeader(source.text, source.id);
      const text = [...parsed.entries].reverse().reduce((text, entry) => {
        if (owned.has(entry.name) && entry.span)
          return text.slice(0, entry.span.start) + text.slice(entry.span.end);
        return text;
      }, source.text);
      for (const entry of parsed.entries) owned.add(entry.name);
      return { ...source, text };
    })
    .reverse();
}
