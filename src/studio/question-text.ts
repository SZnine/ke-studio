import type { Question } from "./language";
export function splitKe(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const prompt: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const comment = line.match(/^\s*(?:--|\/\/)\s?(.*)$/);
    if (!comment || comment[1].startsWith("@")) break;
    prompt.push(comment[1]);
    index++;
  }
  return { prompt: prompt.join("\n"), ke: lines.slice(index).join("\n") };
}
export function exportKe(item: Pick<Question, "prompt" | "ke">) {
  return (
    (item.prompt.trim()
      ? item.prompt
          .split(/\r?\n/)
          .map((line) => "-- " + line)
          .join("\n") + "\n\n"
      : "") + item.ke
  );
}
