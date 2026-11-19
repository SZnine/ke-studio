import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import rangesBySource from "./legacy-question-math.json";

type MathRange = readonly [start: number, end: number];
interface PreparedMath {
  value: string;
  sourceOffset?: (offset: number) => number;
}
const known: Readonly<Record<string, { ranges: number[][] } | undefined>> = rangesBySource;

export function insertMathDelimiters(text: string, ranges: readonly MathRange[]) {
  let previous = 0, value = "";
  const inserted: number[] = [];
  for (const [start, end] of ranges) {
    value += text.slice(previous, start);
    inserted.push(value.length);
    value += "$" + text.slice(start, end);
    inserted.push(value.length);
    value += "$";
    previous = end;
  }
  value += text.slice(previous);
  return {
    value,
    sourceOffset: (offset: number) => offset - inserted.filter((index) => index < offset).length,
  };
}

/** The workbook's original conics prompts include bare TeX. Wrap only reviewed,
 * byte-matched prompts and keep offsets anchored to the saved text. */
export function legacyQuestionMath(text: string): PreparedMath {
  if (!text.includes("\\")) return { value: text };
  const fingerprint = bytesToHex(sha256(new TextEncoder().encode(text)));
  const ranges = known[fingerprint]?.ranges;
  return ranges
    ? insertMathDelimiters(text, ranges.map(([start, end]) => [start, end]))
    : { value: text };
}
