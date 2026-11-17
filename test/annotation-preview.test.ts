import { expect, it } from "vitest";
import { renderMarkdown, updateMarkdown } from "../web/studio/markdown";
import type { TextAnnotation } from "../src/studio/language";
function mark(
  text: string,
  quote: string,
  start = text.indexOf(quote),
  id = "concept-1",
): TextAnnotation {
  return {
    id,
    start,
    end: start + quote.length,
    quote,
    kind: "concept",
    name: "Real",
    declaration: "concept Real;",
  };
}
it("uses source offsets to highlight the selected occurrence through Markdown formatting", () => {
  const text = "x 与 **x** 都是实数";
  const html = renderMarkdown(text, [mark(text, "x", text.lastIndexOf("x"))]);
  expect(html).toContain("<p>x 与 <strong><mark");
  expect(html).toContain(">x</mark></strong> 都是实数</p>");
  expect(html.match(/data-annotation-ids=/g)).toHaveLength(1);
});
it("keeps partial and overlapping formula evidence clickable without inserting markup into TeX", () => {
  const text = String.raw`当实数 $p$ 取何值时，方程 $\sqrt{x^2-p}+2\sqrt{x^2-1}=x$ 有实根？`;
  const annotations = [
    mark(text, "x"),
    mark(text, "x^2-p}", text.indexOf("x^2-p}"), "concept-2"),
  ];
  const html = renderMarkdown(text, annotations);
  expect(html.match(/class="katex"/g)).toHaveLength(2);
  expect(html).not.toContain("katex-error");
  expect(html).toContain(
    'data-annotation-ids="[&quot;concept-1&quot;,&quot;concept-2&quot;]"',
  );
  expect(html).toContain(
    'encoding="application/x-tex">\\sqrt{x^2-p}+2\\sqrt{x^2-1}=x</annotation>',
  );
  expect(html.match(/preview-evidence/g)).toHaveLength(1);
});
it("supports block formulas, alternate delimiters, lists and code without moving evidence offsets", () => {
  for (const text of [
    String.raw`原文 \(x+1\)`,
    "$$\nx+1\n$$",
    "- **值** x\n- x",
    "`x` 代码",
  ]) {
    const html = renderMarkdown(text, [mark(text, "x")]);
    expect(html).toContain("preview-evidence");
    expect(html).not.toContain("katex-error");
  }
  const code = renderMarkdown("`\\(x\\)`\n\n```math\nx+1\n```");
  expect(code).toContain("<code>\\(x\\)</code>");
  expect(code.match(/class="katex"/g)).toHaveLength(1);
});
it("updates the preview when a mark is added or removed while the source stays unchanged", () => {
  const host = {
    innerHTML: "",
    classList: { add() {} },
  } as unknown as HTMLElement;
  const text = "实数 $x$";
  updateMarkdown(host, text, [mark(text, "x")]);
  expect(host.innerHTML).toContain("preview-evidence");
  updateMarkdown(host, text, []);
  expect(host.innerHTML).not.toContain("preview-evidence");
  expect(host.innerHTML).toContain('class="katex"');
});
