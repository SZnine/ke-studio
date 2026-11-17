import { match } from "pinyin-pro";

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
const phonetic = (text: string) =>
  normalize(text)
    .normalize("NFD")
    .replace(/u\u0308/g, "v")
    .replace(/\p{M}/gu, "");
interface Hit {
  start: number;
  length: number;
}
const cache = new Map<string, Hit | null>();
const cacheLimit = 4096;

/** Local, bounded lookup. Text is part of the key so edited notes cannot retain stale matches. */
function pinyinHit(text: string, query: string): Hit | null {
  if (!/\p{Script=Han}/u.test(text)) return null;
  const value = phonetic(text.slice(0, 512)),
    key = query + "\0" + value;
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  // Adjacent characters only: do not match scattered initials across an entire comment.
  const indices = match(value, query, {
    continuous: true,
    precision: "first",
    lastPrecision: "start",
    v: true,
  });
  const hit = indices?.length
    ? { start: indices[0], length: indices.length }
    : null;
  if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
  cache.set(key, hit);
  return hit;
}

/** Literal identifiers/notes stay ahead of phonetic matches; type and scope filtering happen upstream. */
export function completionSearchRank(
  query: string,
  name: string,
  aliases: string[],
  descriptions: string[],
): number {
  const q = normalize(query);
  if (!q || normalize(name).startsWith(q)) return 0;
  if (aliases.some((alias) => normalize(alias).startsWith(q))) return 1;
  if (
    (q.length >= 2 && normalize(name).includes(q)) ||
    aliases.some((alias) => normalize(alias).includes(q))
  )
    return 2;
  if (q.length >= 2 && descriptions.some((text) => normalize(text).includes(q)))
    return 3;
  const roman = phonetic(q).replace(/_/g, "");
  if (
    !/[a-z]/.test(roman) ||
    !/^[a-z0-9\p{Script=Han}]+$/u.test(roman) ||
    roman.length > 96
  )
    return -1;
  let rank = -1;
  for (const text of [name, ...aliases]) {
    const hit = pinyinHit(text, roman);
    if (!hit) continue;
    if (hit.start === 0) return 4;
    if (roman.length >= 2) rank = 5;
  }
  if (rank >= 0) return rank;
  if (
    roman.length >= 2 &&
    descriptions.some((text) => (pinyinHit(text, roman)?.length ?? 0) >= 2)
  )
    return 6;
  return -1;
}
