import type {
  ChatContext,
  ChatEvent,
  ChatMessage,
  Workspace,
} from "../../src/studio/language";
import type { Change } from "../../src/studio/store";
import { request, connectionError } from "./api";
import { events } from "../../src/studio/sse";
import { createSteps } from "./steps";
import { changeFiles } from "./change-files";
import { renderProse } from "./prose";

interface Host {
  workspace(): Workspace | undefined;
  context(): ChatContext;
  save(): Promise<void>;
  apply(workspace: Workspace): void;
  request<T>(url: string, method?: string, data?: unknown): Promise<T>;
  diff(before: string, after: string): HTMLElement;
  settings(): void;
}
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};

export function createChat(host: Host) {
  const panel = document.querySelector<HTMLElement>("#assistant-panel")!;
  const list = panel.querySelector<HTMLElement>("#chat-messages")!;
  const form = panel.querySelector<HTMLFormElement>("#chat-form")!;
  const input = panel.querySelector<HTMLTextAreaElement>("#chat-input")!;
  const send = panel.querySelector<HTMLButtonElement>("#chat-send")!;
  const stop = panel.querySelector<HTMLButtonElement>("#chat-stop")!;
  const fresh = panel.querySelector<HTMLButtonElement>("#chat-new")!;
  const status = panel.querySelector<HTMLElement>("#chat-status")!;
  const error = panel.querySelector<HTMLElement>("#chat-error")!;
  const bottom = panel.querySelector<HTMLButtonElement>("#chat-bottom")!;
  let bank = "";
  let selected = "",
    pending = "",
    loading = 0;
  let live: HTMLElement | undefined;
  let streaming: ChatMessage | undefined;
  const timelines = new WeakMap<HTMLElement, ReturnType<typeof createSteps>>();
  const follow = (update: () => void) => {
    const position = list.scrollTop;
    update();
    list.scrollTop = position;
    bottom.hidden = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
  };
  bottom.addEventListener("click", () => {
    list.scrollTop = list.scrollHeight;
    bottom.hidden = true;
  });
  list.addEventListener("scroll", () => {
    bottom.hidden = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
  });

  function fail(value: unknown) {
    error.textContent = value instanceof Error ? value.message : String(value);
    error.hidden = false;
  }
  function controls() {
    send.disabled = !!pending || !input.value.trim();
    stop.hidden = !pending;
    fresh.disabled = !!pending;
    panel
      .querySelectorAll<HTMLButtonElement>(".chat-shortcuts button")
      .forEach((button) => {
        button.disabled = !!pending;
      });
  }
  function append(message: ChatMessage, existing?: HTMLElement) {
    list.querySelector(".chat-empty")?.remove();
    const item =
      existing || node("article", "", `chat-message ${message.role}`);
    if (!existing) {
      item.append(
        node(
          "small",
          message.role === "user"
            ? `你${message.question ? " · " + message.question.number : ""}`
            : "KE 助手",
        ),
      );
      if (message.role === "assistant") timelines.set(item, createSteps(item));
      item.append(node("div", "", "chat-text"));
    }
    renderProse(item.querySelector(".chat-text")!, message);
    for (const step of message.steps || []) timelines.get(item)?.(step);
    for (const change of message.changes || []) {
      const detail = node("details", "", "chat-change");
      detail.append(node("summary", change.reason.replace(/^模型：/, "")));
      let loaded = false;
      detail.addEventListener("toggle", async () => {
        if (!detail.open || loaded) return;
        loaded = true;
        try {
          const full = await host.request<Change>(
            "/api/history?id=" + encodeURIComponent(change.id),
          );
          for (const file of changeFiles(full))
            detail.append(
              node("small", file.file),
              host.diff(file.before, file.after),
            );
        } catch (error) {
          loaded = false;
          fail(error);
        }
      });
      item.append(detail);
    }
    if (message.state === "error" || message.state === "stopped") {
      if (!item.querySelector(".chat-continue")) {
        const resume = node("button", "继续", "button chat-continue");
        resume.addEventListener("click", () => {
          if (pending) return;
          input.value =
            "继续上次任务，先核对已完成的步骤，再分批处理未完成的内容。";
          void submit(message.context?.intent, message.context);
        });
        item.append(resume);
      }
    }
    if (!existing) follow(() => list.append(item));
    return item;
  }
  async function load() {
    const domain = selected,
      ticket = ++loading;
    const messages = await host.request<ChatMessage[]>(
      "/api/chat?domain=" + encodeURIComponent(domain),
    );
    if (ticket !== loading || domain !== selected) return;
    list.replaceChildren();
    if (messages.length)
      messages.forEach((message) => {
        if (message.state === "running" && domain === pending && streaming)
          live = append(streaming);
        else append(message);
      });
    else
      list.append(
        node(
          "p",
          "从一道题开始。\n可以说“检查第 03 题”，也可以调整语法或字典。",
          "chat-empty",
        ),
      );
    list.scrollTop = list.scrollHeight;
    bottom.hidden = true;
  }
  function sync() {
    const state = host.workspace();
    if (!state) return;
    panel.querySelector("#chat-domain")!.textContent = state.domain.name;
    panel.querySelector("#chat-context")!.textContent =
      (host.context().questionId || host.context().draftId) && state.question
        ? (state.question.draft ? "草稿 · " : "当前题 · ") +
          state.question.number
        : "当前题库 · 可按题号提问";
    panel.querySelector<HTMLElement>("#chat-draft-note")!.hidden =
      !host.context().languageDraft;
    if (selected !== state.domain.id || bank !== state.storage.bank) {
      bank = state.storage.bank;
      selected = state.domain.id;
      error.hidden = true;
      input.value = "";
      if (!panel.hidden) void load().catch(fail);
    }
    controls();
  }
  async function open() {
    sync();
    panel.hidden = false;
    document.body.classList.add("chat-open");
    document.querySelector("#ask-model")?.setAttribute("aria-expanded", "true");
    if (pending !== selected || !live?.isConnected) await load();
    input.focus();
  }
  panel.querySelector("#chat-close")!.addEventListener("click", () => {
    panel.hidden = true;
    document.body.classList.remove("chat-open");
    document
      .querySelector("#ask-model")
      ?.setAttribute("aria-expanded", "false");
    document.querySelector<HTMLButtonElement>("#ask-model")?.focus();
  });
  panel
    .querySelector("#chat-settings")!
    .addEventListener("click", host.settings);
  fresh.addEventListener("click", () => {
    void host
      .request("/api/chat?domain=" + encodeURIComponent(selected), "DELETE")
      .then(() => {
        input.value = "";
        error.hidden = true;
        controls();
        return load();
      })
      .catch(fail);
  });
  input.addEventListener("input", controls);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });
  stop.addEventListener("click", () => {
    stop.disabled = true;
    status.textContent = "正在停止…";
    void host
      .request("/api/chat/stop", "POST", { domain: pending })
      .catch((error) => {
        fail(error);
        stop.disabled = false;
      });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
  async function submit(
    intent?: ChatContext["intent"],
    continuation?: ChatContext,
  ) {
    const text = input.value.trim(),
      state = host.workspace();
    if (pending || !text || !state) return;
    if (!state.model.hasKey) {
      host.settings();
      return;
    }
    pending = state.domain.id;
    const domain = pending,
      context = continuation || { ...host.context(), intent };
    error.hidden = true;
    controls();
    stop.disabled = true;
    status.textContent = "正在准备…";
    let completed = false;
    live = undefined;
    streaming = {
      id: "",
      role: "assistant",
      content: "",
      steps: [],
      state: "running",
      context,
    };
    try {
      await host.save();
      input.value = "";
      ++loading; // Do not let a late history request erase the just-sent message.
      if (selected === domain) {
        append({
          id: "",
          role: "user",
          content: text,
          question:
            (context.questionId || context.draftId) && state.question
              ? {
                  id: state.question.id,
                  number: state.question.number,
                  draft: state.question.draft,
                }
              : undefined,
        });
        list.scrollTop = list.scrollHeight;
        bottom.hidden = true;
      }
      const response = await request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, message: text, context }),
      });
      for await (const data of events(response)) {
        const event: ChatEvent = JSON.parse(data);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "status") {
          status.textContent = event.text;
          stop.disabled = false;
        }
        if (event.type === "text" || event.type === "step") {
          if (event.type === "step") {
            const index = streaming!.steps!.findIndex(
              (step) => step.id === event.step.id,
            );
            if (index < 0) streaming!.steps!.push(event.step);
            else streaming!.steps![index] = event.step;
          } else {
            const step = streaming!.steps!.find(
              (step) => step.id === event.stepId,
            );
            if (step) step.explanation = (step.explanation || "") + event.text;
          }
          if (selected !== domain) continue;
          if (!live?.isConnected) live = append(streaming!);
          follow(() => {
            if (event.type === "step") timelines.get(live!)?.(event.step);
            renderProse(live!.querySelector(".chat-text")!, streaming!);
          });
        }
        if (event.type === "complete") {
          completed = true;
          if (selected === domain) {
            follow(() => append(event.message, live));
            host.apply(event.workspace);
          }
          live = undefined;
        }
      }
      if (!completed)
        throw new Error("连接已中断。重新打开对话可查看已保存的结果。");
    } catch (error) {
      fail(error instanceof TypeError ? connectionError(error) : error);
      if (!input.value) input.value = text;
    } finally {
      pending = "";
      streaming = undefined;
      status.textContent = "";
      controls();
      if (!panel.hidden) input.focus();
    }
  }
  async function quick(intent: NonNullable<ChatContext["intent"]>) {
    if (pending) return;
    await open();
    input.value =
      intent === "co-update"
        ? "根据当前题目或草稿更新本领域 CO 库，生成待审建议。"
        : "分析当前题目或草稿与 CO、语法的冲突，给出依据和待审优化建议。";
    controls();
    await submit(intent);
  }
  return { open, sync, quick };
}
