import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import type { Root as MarkdownRoot } from "mdast";
import type { Root, Element, RootContent } from "hast";
import type { VFile } from "vfile";
import type { TextAnnotation } from "../../src/studio/language";
import { legacyQuestionMath } from "./legacy-question-math";

const parser = unified().use(remarkParse);
/** Alternate math delimiters retain their length so annotations keep original offsets. */
function mathDelimiters(text: string) {
  if (!/\\[([]/.test(text)) return text;
  const code: { start: number; end: number }[] = [];
  function collect(node: any) {
    if (node.type === "code" || node.type === "inlineCode")
      code.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
    else node.children?.forEach(collect);
  }
  collect(parser.parse(text));
  return text.replace(
    /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g,
    (raw, inline, block, offset) => {
      if (
        code.some(
          (range) => offset < range.end && range.start < offset + raw.length,
        )
      )
        return raw;
      let slashes = 0;
      for (let i = offset - 1; text[i] === "\\"; i--) slashes++;
      if (slashes % 2) return raw;
      return inline === undefined ? "$$" + block + "$$" : "$ " + inline + " $";
    },
  );
}

function literalHtml() {
  return (tree: MarkdownRoot) => {
    function visit(node: any) {
      if (node.type === "html") node.type = "text";
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}

/** Decorate parsed leaves, never insert markup into LaTeX or guess repeated text matches. */
function evidence() {
  return (tree: Root, file: VFile) => {
    const source = String(file.data.source || file.value);
    const sourceOffset = file.data.sourceOffset as
      | ((offset: number) => number)
      | undefined;
    const annotations =
      (file.data.annotations as TextAnnotation[] | undefined) || [];
    const valid = annotations.filter(
      (mark) => source.slice(mark.start, mark.end) === mark.quote,
    );
    const wrap = (
      node: RootContent,
      marks: TextAnnotation[],
      block = false,
    ): Element => ({
      type: "element",
      tagName: block ? "div" : "mark",
      properties: {
        className: ["preview-evidence", "evidence-" + marks[0].kind],
        dataAnnotationIds: JSON.stringify(marks.map((mark) => mark.id)),
        tabIndex: 0,
        role: "button",
        title: marks.map((mark) => mark.declaration).join("\n"),
        ariaLabel: marks
          .map(
            (mark) =>
              `${mark.kind === "concept" ? "概念" : "算子"} ${mark.name}`,
          )
          .join("、"),
      },
      children: [node as Element["children"][number]],
    });
    function decorate(node: RootContent): RootContent[] {
      const from = node.position?.start.offset,
        to = node.position?.end.offset;
      const start = from === undefined ? undefined : sourceOffset?.(from) ?? from,
        end = to === undefined ? undefined : sourceOffset?.(to) ?? to;
      const marks =
        start === undefined || end === undefined
          ? []
          : valid.filter((mark) => mark.start < end && start < mark.end);
      if (marks.length && start !== undefined && end !== undefined) {
        if (node.type === "element" && ["code", "pre"].includes(node.tagName))
          return [wrap(node, marks, node.tagName === "pre")];
        if (node.type === "text") {
          if (source.slice(start, end) !== node.value)
            return [wrap(node, marks)];
          const boundaries = [
            ...new Set([
              start,
              end,
              ...marks.flatMap((mark) => [
                Math.max(start, mark.start),
                Math.min(end, mark.end),
              ]),
            ]),
          ].sort((a, b) => a - b);
          return boundaries.slice(0, -1).map((from, index) => {
            const to = boundaries[index + 1];
            const matching = marks.filter(
              (mark) => mark.start < to && from < mark.end,
            );
            const text: RootContent = {
              type: "text",
              value: source.slice(from, to),
            };
            return matching.length ? wrap(text, matching) : text;
          });
        }
      }
      if (node.type === "element") {
        if (node.tagName === "a") {
          const href = String(node.properties.href || "");
          if (
            /^(?:javascript|vbscript|data):/i.test(
              href.replace(/[\s\u0000-\u001f]/g, ""),
            )
          )
            delete node.properties.href;
          node.properties.target = "_blank";
          node.properties.rel = ["noopener", "noreferrer"];
        }
        node.children = node.children.flatMap(decorate) as Element["children"];
      }
      return [node];
    }
    tree.children = tree.children.flatMap(decorate);
  };
}

const markdown = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkBreaks)
  .use(literalHtml)
  .use(remarkRehype)
  .use(evidence)
  .use(rehypeKatex, { trust: false, strict: "ignore", errorColor: "#e76a61" })
  .use(rehypeStringify, { characterReferences: { useNamedReferences: true } });

export const renderMarkdown = (
  text: string,
  annotations: TextAnnotation[] = [],
) => {
  const { value, sourceOffset } = legacyQuestionMath(text);
  return String(
    markdown.processSync({
      value: mathDelimiters(value),
      data: { source: text, annotations, sourceOffset },
    }),
  );
};
const rendered = new WeakMap<HTMLElement, string>();
export function updateMarkdown(
  host: HTMLElement,
  text: string,
  annotations: TextAnnotation[] = [],
) {
  const key = JSON.stringify([text, annotations]);
  if (rendered.get(host) === key) return;
  rendered.set(host, key);
  host.classList.add("markdown");
  host.innerHTML = renderMarkdown(text, annotations);
}
