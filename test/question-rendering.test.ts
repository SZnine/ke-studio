import { expect, it } from "vitest";
import { exportKe, splitKe } from "../src/studio/question-text";
import { insertMathDelimiters, legacyQuestionMath } from "../web/studio/legacy-question-math";
import { renderMarkdown } from "../web/studio/markdown";

it("round-trips blank lines and comments at the start of the KE body", () => {
  const prompt = "第一段\n\n第二段";
  const ke = "\n// KE 文件备注\nconcept Shape;\n";
  expect(splitKe(exportKe({ prompt, ke }))).toEqual({ prompt, ke });
});

it("recognizes a legacy leading comment header while preserving CO metadata", () => {
  expect(splitKe("-- 题干\r\n-- 第二行\r\n// @label 形状\r\nconcept Shape;")).toEqual({
    prompt: "题干\n第二行",
    ke: "// @label 形状\nconcept Shape;",
  });
});

it("maps inserted delimiters and surrounding text to unchanged prompt offsets", () => {
  const source = String.raw`式 \sqrt{2} 与 x^{2}，求值。`;
  const first = source.indexOf("\\sqrt");
  const second = source.indexOf("x^");
  const { value, sourceOffset } = insertMathDelimiters(source, [
    [first, first + "\\sqrt{2}".length],
    [second, second + "x^{2}".length],
  ]);
  expect(value).toBe(String.raw`式 $\sqrt{2}$ 与 $x^{2}$，求值。`);
  expect(sourceOffset(value.indexOf("\\sqrt"))).toBe(first);
  expect(sourceOffset(value.indexOf("x^"))).toBe(second);
  expect(sourceOffset(value.indexOf("求值"))).toBe(source.indexOf("求值"));
  expect(renderMarkdown(value).match(/class="katex"/g)).toHaveLength(2);
});

it("leaves unmatched legacy-looking text and code examples unchanged", () => {
  const unknown = String.raw`原文提到 \frac{x}{2}，以字面方式保存。`;
  expect(legacyQuestionMath(unknown)).toEqual({ value: unknown });
  const literalCode = "`" + String.raw`\(x\)` + "`";
  expect(renderMarkdown(literalCode)).toContain("<code>\\(x\\)</code>");
});
