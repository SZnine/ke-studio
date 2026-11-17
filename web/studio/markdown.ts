import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  _env,
  renderer,
) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};

export const renderMarkdown = (text: string) => markdown.render(text);
const rendered = new WeakMap<HTMLElement, string>();

export function updateMarkdown(host: HTMLElement, text: string) {
  if (rendered.get(host) === text) return;
  rendered.set(host, text);
  host.classList.add("markdown");
  // Raw HTML is escaped by the parser; code stays literal, even with an unfinished fence.
  host.innerHTML = renderMarkdown(text);
}
