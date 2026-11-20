import { typeParts } from "../../studio/language/types";
import type { Language } from "./engine";
import { entryKey, type Entry } from "./language";

export function coSignature(entry: Entry) {
  return JSON.stringify([
    entryKey(entry),
    entry.type,
    entry.parent,
    entry.parentForm,
  ]);
}

export function documentCo(language: Language, text: string) {
  if (!text.trim()) return [];
  const { entries, issues } = language.readHeader(text, "question.ke");
  return entries
    .filter((entry) => {
      if (
        entry.draft ||
        !entry.name ||
        !["concept", "operator"].includes(entry.kind)
      )
        return false;
      const span = entry.span;
      return (
        span &&
        !issues.some(
          (issue) =>
            issue.code !== "library" &&
            issue.start < span.end &&
            issue.end > span.start,
        )
      );
    })
    .map(({ span, ...entry }) => entry);
}

interface SourceDocument {
  key: string;
  text: string;
}

/** Session index of documented concepts and operators across the mounted banks. */
export class CoCatalog {
  private documents = new Map<
    string,
    { text: string; entries: Entry[]; observedAt: number }
  >();
  private scan?: Promise<void>;
  private removedDomains = new Set<string>();
  private observed = 0;
  private definitionsVersion = 0;
  private cached?: { version: number; entries: Entry[] };

  get revision() {
    return this.definitionsVersion;
  }

  get readStamp() {
    return this.observed;
  }

  load(language: Language, documents: () => AsyncIterable<SourceDocument>) {
    return (this.scan ??= (async () => {
      const stamp = this.readStamp;
      for await (const { key, text } of documents())
        this.observe(language, key, text, stamp);
    })().catch((error) => {
      this.scan = undefined;
      throw error;
    }));
  }

  observe(language: Language, key: string, text: string, stamp: number) {
    // Workspaces and the bank scan can read while a save is in flight. Use the newer value.
    if (
      (this.documents.get(key)?.observedAt ?? 0) > stamp ||
      this.removedDomains.has(key.split("/")[1])
    )
      return;
    this.update(language, key, text);
  }

  update(language: Language, key: string, text: string) {
    const previous = this.documents.get(key);
    const observedAt = ++this.observed;
    if (previous?.text === text) {
      previous.observedAt = observedAt;
      return false;
    }
    const entries = documentCo(language, text);
    this.documents.set(key, { text, entries, observedAt });
    if (JSON.stringify(previous?.entries ?? []) === JSON.stringify(entries))
      return false;
    this.definitionsVersion++;
    return true;
  }

  removeDomains(ids: string[]) {
    for (const id of ids) this.removedDomains.add(id);
    for (const key of this.documents.keys()) {
      if (!this.removedDomains.has(key.split("/")[1])) continue;
      if (this.documents.get(key)!.entries.length) this.definitionsVersion++;
      this.documents.delete(key);
    }
  }

  restoreDomains(ids: string[]) {
    for (const id of ids) this.removedDomains.delete(id);
    this.scan = undefined;
  }

  get entries() {
    if (this.cached?.version === this.definitionsVersion)
      return this.cached.entries;
    const definitions = new Map<string, Entry>();
    for (const { entries } of this.documents.values()) {
      const seen = new Set<string>();
      for (const entry of entries) {
        const signature = coSignature(entry);
        if (seen.has(signature)) continue;
        seen.add(signature);
        const found = definitions.get(signature);
        if (found) found.usage = (found.usage ?? 0) + 1;
        else definitions.set(signature, { ...entry, usage: 1 });
      }
    }
    const entries = [...definitions.values()].sort((a, b) =>
      coSignature(a).localeCompare(coSignature(b)),
    );
    this.cached = { version: this.definitionsVersion, entries };
    return entries;
  }
}

/** Only unambiguous and self-contained fallback definitions enter a question's scope. */
export function supplementalCo(
  layers: Entry[][],
  preferred: Entry[],
  core: Entry[],
) {
  const known = new Set([...preferred, ...core].map((entry) => entry.name));
  const types = new Set(
    [...preferred, ...core]
      .filter((entry) => entry.kind === "concept")
      .map((entry) => entry.name),
  );
  types.add("operator");
  const candidates = new Map<string, Entry[]>();
  for (const layer of layers) {
    const additions = new Map<string, Entry[]>();
    for (const entry of layer) {
      if (
        known.has(entry.name) ||
        candidates.has(entry.name) ||
        entry.draft ||
        !["concept", "operator"].includes(entry.kind)
      )
        continue;
      const alternatives = additions.get(entry.name) ?? [];
      if (
        !alternatives.some((other) => coSignature(other) === coSignature(entry))
      )
        additions.set(entry.name, [...alternatives, entry]);
    }
    for (const [name, alternatives] of additions)
      candidates.set(name, alternatives);
  }
  const unique = [...candidates.values()].flatMap((alternatives) => {
    if (alternatives.length === 1) return alternatives;
    if (alternatives.some((entry) => entry.kind !== "operator")) return [];
    const signatures = new Set(alternatives.map(entryKey));
    return signatures.size === alternatives.length ? alternatives : [];
  });
  const validType = (name: string): boolean =>
    types.has(name) || (typeParts(name)?.every(validType) ?? false);
  const concepts: Entry[] = [];
  let awaiting = unique.filter((entry) => entry.kind === "concept");
  while (awaiting.length) {
    const ready = awaiting.filter(
      (entry) => !entry.parent || validType(entry.parent),
    );
    if (!ready.length) break;
    for (const entry of ready) types.add(entry.name);
    concepts.push(...ready);
    awaiting = awaiting.filter((entry) => !types.has(entry.name));
  }
  return [
    ...concepts,
    ...unique.filter(
      (entry) =>
        entry.kind === "operator" &&
        validType(entry.type) &&
        entry.params.every((param) => validType(param.type)),
    ),
  ];
}
