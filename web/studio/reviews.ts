import type { Proposal, Workspace } from "../../src/studio/language";
import { api } from "./api";

export function createReviews(host: {
  workspace(): Workspace;
  apply(state: Workspace): void;
  diff(before: string, after: string): HTMLElement;
  notify(text: string, error?: boolean): void;
}) {
  const dialog = document.querySelector<HTMLDialogElement>("#review-dialog")!;
  const list = dialog.querySelector<HTMLElement>("#review-list")!;
  const trigger = document.querySelector<HTMLButtonElement>("#review-open")!;
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ) => {
    const e = document.createElement(tag);
    e.textContent = text;
    e.className = className;
    return e;
  };
  async function decide(
    proposal: Proposal,
    selected: string[],
    form: HTMLFormElement,
  ) {
    const error = form.querySelector<HTMLElement>(".form-error")!;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const state = host.workspace();
      host.apply(
        await api("/api/proposals/decide", "POST", {
          domain: state.domain.id,
          id: proposal.id,
          selected,
          questionId: state.question?.id,
          draft: state.question?.draft,
        }),
      );
      render();
      host.notify(
        selected.length
          ? `已采纳 ${selected.length} 项，其余已忽略`
          : "已忽略这组建议",
      );
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
    } finally {
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
      form.querySelector<HTMLButtonElement>("[type=submit]")!.disabled =
        !form.querySelector("input:checked");
    }
  }
  let rendered = "";
  function render() {
    const proposals = host.workspace()?.proposals || [];
    trigger.textContent = proposals.length
      ? `待审建议 (${proposals.length})`
      : "待审建议";
    trigger.disabled = !proposals.length;
    if (!dialog.open) return;
    const signature = JSON.stringify(proposals);
    if (rendered === signature) return;
    const choices = new Map(
      [...list.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].map(
        (e) => [e.value, e.checked],
      ),
    );
    const expanded = new Set(
      [...list.querySelectorAll<HTMLDetailsElement>("details[open]")].map(
        (element) => element.dataset.id,
      ),
    );
    const scroll = list.parentElement!;
    const position = scroll.scrollTop;
    rendered = signature;
    list.replaceChildren();
    if (!proposals.length) {
      list.append(node("p", "全部处理完成。", "muted"));
      return;
    }
    for (const proposal of proposals) {
      const group = node("details", "", "review-group");
      group.dataset.id = proposal.id;
      group.open = expanded.has(proposal.id);
      const heading = node("summary", proposal.reason);
      heading.append(node("span", `${proposal.items.length} 项`, "type-tag"));
      group.append(heading);
      const form = node("form");
      for (const item of proposal.items) {
        const row = node("details", "", "review-item"),
          summary = node("summary"),
          label = node("label"),
          check = node("input");
        row.dataset.id = item.id;
        row.open = expanded.has(item.id);
        check.type = "checkbox";
        check.value = item.id;
        check.checked = choices.get(item.id) ?? item.recommended;
        label.append(
          check,
          node("strong", item.title),
          node("span", item.recommended ? "建议采纳" : "可选优化", "type-tag"),
        );
        label.addEventListener("click", (event) => event.stopPropagation());
        summary.append(label);
        row.append(
          summary,
          node("p", item.reason),
          host.diff(item.before, item.after),
        );
        form.append(row);
      }
      const error = node("p", "", "form-error");
      error.hidden = true;
      const actions = node("div", "", "dialog-actions"),
        reject = node("button", "忽略这组", "button"),
        accept = node("button", "采纳所选", "button primary");
      reject.type = "button";
      accept.type = "submit";
      reject.addEventListener("click", () => void decide(proposal, [], form));
      const chosen = () =>
        [...form.querySelectorAll<HTMLInputElement>("input:checked")].map(
          (e) => e.value,
        );
      const update = () => {
        accept.disabled = !chosen().length;
        accept.textContent = `采纳所选 (${chosen().length})`;
      };
      form.addEventListener("change", update);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (chosen().length) void decide(proposal, chosen(), form);
      });
      actions.append(reject, accept);
      form.append(error, actions);
      group.append(form);
      list.append(group);
      update();
    }
    scroll.scrollTop = position;
  }
  trigger.addEventListener("click", () => {
    dialog.showModal();
    render();
  });
  return { render };
}
