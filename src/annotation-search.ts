import { completionSearchRank } from "./completion-search";
import type { Entry, TextAnnotation } from "./studio/language";

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim();
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const words = (value: string) => [
  ...new Set([
    ...[...segmenter.segment(value)]
      .filter((part) => part.isWordLike && part.segment.length > 1)
      .map((part) => part.segment),
    // Domain terms may be split by the general-purpose word segmenter.
    ...[...value.matchAll(/(?=(\p{Script=Han}{2}))/gu)].map(
      (match) => match[1],
    ),
  ]),
];

// Latin identifiers need word boundaries; Chinese labels can be inside a phrase.
function contains(text: string, term: string) {
  if (!term) return false;
  if (/\p{Script=Han}/u.test(term)) return text.includes(term);
  return text.split(/[^\p{L}\p{N}_]+/u).includes(term);
}

/** Evidence search is separate from identifier completion: a whole phrase may contain several CO clues. */
export function annotationChoices(
  entries: Entry[],
  kind: TextAnnotation["kind"],
  query: string,
  quote: string,
  usage: Record<string, number> = {},
): Entry[] {
  const candidates = entries
    .filter((entry) => entry.kind === kind)
    .map((entry) => ({
      entry,
      names: [entry.name, entry.label || "", ...(entry.aliases || [])]
        .filter(Boolean)
        .map(normalize),
      descriptions: [
        entry.description || "",
        entry.returnDescription || "",
        ...entry.params.map((parameter) => parameter.description || ""),
      ]
        .filter(Boolean)
        .map(normalize),
    }));
  function scorer(text: string) {
    const value = normalize(text),
      terms = [
        ...new Set([
          ...words(value),
          ...candidates.flatMap((item) =>
            item.names.filter(
              (name) => /\p{Script=Han}/u.test(name) && contains(value, name),
            ),
          ),
        ]),
      ];
    // Rare clues count more than wording repeated in many descriptions.
    const weights = terms.map(
      (term) =>
        1 +
        Math.log(
          (candidates.length + 1) /
            (1 +
              candidates.filter((item) =>
                [...item.names, ...item.descriptions].some((field) =>
                  contains(field, term),
                ),
              ).length),
        ),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return (item: (typeof candidates)[number]) => {
      if (!value) return 0;
      const { names, descriptions, entry } = item;
      let score = 0;
      for (const name of names) {
        if (name === value) score = Math.max(score, 1000);
        else if (
          (name.length > 1 || /\p{Script=Han}/u.test(name)) &&
          contains(value, name)
        )
          score = Math.max(score, 300 + (80 * name.length) / value.length);
        else if (
          name.startsWith(value) ||
          (value.length > 1 && contains(name, value))
        )
          score = Math.max(score, 800 + (80 * value.length) / name.length);
      }
      if (
        value.length > 1 &&
        descriptions.some((field) => contains(field, value))
      )
        score = Math.max(score, 700);
      const phonetic = completionSearchRank(
        value,
        entry.name,
        [entry.label || "", ...(entry.aliases || [])],
        descriptions,
      );
      if (phonetic >= 0) score = Math.max(score, 690 - 10 * phonetic);
      if (total) {
        const matched = terms.reduce(
          (sum, term, index) =>
            sum +
            weights[index] *
              (names.some((field) => contains(field, term))
                ? 1
                : descriptions.some((field) => contains(field, term))
                  ? 0.7
                  : 0),
          0,
        );
        const coverage = matched / total;
        score = Math.max(score, 600 * coverage) + 100 * coverage;
      }
      return score;
    };
  }
  const input = query.trim() || quote.trim();
  const primary = scorer(input),
    evidence = scorer(query.trim() ? quote : "");
  return candidates
    .map((item) => ({
      entry: item.entry,
      score: primary(item),
      evidence: evidence(item),
    }))
    .filter((item) => !input || item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.evidence - a.evidence ||
        (usage[b.entry.name] || 0) - (usage[a.entry.name] || 0) ||
        a.entry.name.localeCompare(b.entry.name),
    )
    .slice(0, 8)
    .map((item) => item.entry);
}

/** Keep the selected name, only replacing punctuation that cannot be part of a KE identifier. */
export function annotationName(query: string, quote: string) {
  const name = (query.trim() || quote.trim())
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_]+/gu, "_");
  return /^\p{N}/u.test(name) ? "_" + name : name;
}
