import type { ChatMessage } from "../../src/studio/language";
import { updateMarkdown } from "./markdown";

/** Each model round owns one stable paragraph. Tool rounds never reset earlier prose. */
export function proseBlocks(message: ChatMessage) {
  const blocks = (message.steps || [])
    .filter((step) => step.kind === "model" && step.explanation?.trim())
    .map((step) => ({ id: step.id, text: step.explanation! }));
  if (
    message.content.trim() &&
    message.content.trim() !== blocks.at(-1)?.text.trim()
  )
    blocks.push({ id: "result", text: message.content });
  return blocks;
}

export function renderProse(host: HTMLElement, message: ChatMessage) {
  for (const block of proseBlocks(message)) {
    let paragraph = [...host.children].find(
      (child) => (child as HTMLElement).dataset.block === block.id,
    ) as HTMLElement | undefined;
    if (!paragraph) {
      paragraph = document.createElement("div");
      paragraph.className = "chat-paragraph";
      paragraph.dataset.block = block.id;
      host.append(paragraph);
    }
    if (message.role === "assistant") updateMarkdown(paragraph, block.text);
    else if (paragraph.textContent !== block.text)
      paragraph.textContent = block.text;
  }
}
