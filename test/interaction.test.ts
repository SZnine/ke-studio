import { describe, expect, it } from "vitest";
import { splitKe, exportKe } from "../src/studio/question-text";
import { renderMarkdown } from "../web/studio/markdown";

it("renders Markdown headings, lists, tables, links and literal KE code in question previews", () => {
  const html = renderMarkdown(
    "## 结果\n\n- **已完成** `Concept`\n\n| 类型 | 名称 |\n| --- | --- |\n| CO | 曲线 |\n\n[说明](https://example.com)\n\n```ke\nconcept A <: B;\n",
  );
  expect(html).toContain("<h2>结果</h2>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<strong>已完成</strong>");
  expect(html).toContain("<code>Concept</code>");
  expect(html).toContain("<table>");
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(html).toContain('<code class="language-ke">concept A &lt;: B;');
  expect(renderMarkdown("```ke\nconcept A <: B;\n```\n\n完成。")).toContain(
    "</pre>\n<p>完成。</p>",
  );
});

it("treats raw HTML and unsafe links as text instead of executable markup", () => {
  const html = renderMarkdown(
    "<img src=x onerror=alert(1)>\n\n[打开](javascript:alert(1))",
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;img");
});
it("renders inline and display formulas while keeping code fences and incomplete input readable", () => {
  for (const text of [
    String.raw`题干 $\sqrt{2}$。`,
    String.raw`题干 \(\frac{x^2}{a^2}\)。`,
    "$$\nx^2+y^2=1\n$$",
    String.raw`\[x^2=1\]`,
  ]) {
    const html = renderMarkdown(text);
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
  }
  expect(renderMarkdown("```ke\n$x$\n```")).not.toContain('class="katex"');
  expect(renderMarkdown("还在输入 $x")).toContain("还在输入 $x");
  expect(renderMarkdown(String.raw`$\frac{$`)).toContain("katex-error");
  expect(
    renderMarkdown(String.raw`$\href{javascript:alert(1)}{x}$`),
  ).not.toContain('href="javascript:');
});

describe("Question KE import and export", () => {
  it("separates the original prompt without consuming declaration metadata", () => {
    const item = splitKe(
      "-- 原题第一行\r\n-- 第二行\r\n\r\n// @label 曲线\r\nconcept Curve;",
    );
    expect(item).toEqual({
      prompt: "原题第一行\n第二行",
      ke: "// @label 曲线\nconcept Curve;",
    });
    expect(splitKe(exportKe(item))).toEqual(item);
  });
});
