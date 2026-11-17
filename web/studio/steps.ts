import type { ChatStep } from "../../src/studio/language";
import { updateMarkdown } from "./markdown";

const labels: Record<string, string> = {
  read_coke: "读取标准例",
  read_draft: "读取草稿",
  update_draft: "更新草稿",
  read_proposal: "读取建议",
  read_language: "读取语法",
  read_library: "检索字典",
  list_questions: "查找题目",
  read_question: "读取题目",
  update_question: "更新题目",
  create_question: "创建题目",
  read_history: "读取历史",
  create_domain: "创建领域",
  update_language: "建议更新语法",
  update_library: "建议更新字典",
  apply_update: "生成待审建议",
  restore_change: "恢复修改",
};
const states = {
  receiving: "生成参数",
  running: "执行中",
  complete: "完成",
  error: "失败",
  stopped: "已中断",
};
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};
const pretty = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};
// Keep disclosures and scroll containers alive while streaming. Only their text changes.
export function createSteps(host: HTMLElement) {
  const root = node("details"),
    rootTitle = node("summary");
  root.className = "chat-steps";
  root.hidden = true;
  root.append(rootTitle);
  host.append(root);
  const thought = node("details"),
    thoughtsTitle = node("summary"),
    thoughtsBody = node("div");
  thought.className = "chat-thought";
  thoughtsBody.className = "chat-step-body reasoning";
  thought.append(thoughtsTitle, thoughtsBody);
  thought.hidden = true;
  const tools = node("details"),
    toolsTitle = node("summary"),
    toolsBody = node("div");
  tools.className = "chat-tools";
  tools.append(toolsTitle, toolsBody);
  tools.hidden = true;
  root.append(thought, tools);
  const models = new Map<string, ChatStep>();
  const calls = new Map<
    string,
    {
      step: ChatStep;
      row: HTMLDetailsElement;
      title: HTMLElement;
      input: HTMLElement;
      output: HTMLElement;
    }
  >();
  const summarize = () => {
    const all = [
      ...models.values(),
      ...[...calls.values()].map((item) => item.step),
    ];
    const active = all.find((item) =>
      ["running", "receiving"].includes(item.status),
    );
    const last = all.sort((a, b) => a.started - b.started).at(-1);
    root.dataset.status = active ? "running" : last?.status || "complete";
    rootTitle.textContent = `处理过程${calls.size ? ` · ${calls.size} 次工具调用` : ""} · ${active ? (active.kind === "model" ? "思考中" : labels[active.name] || active.name) : last?.status === "stopped" ? "已中断" : last?.status === "error" ? "失败" : "完成"}`;
  };
  return (step: ChatStep) => {
    root.hidden = false;
    if (step.kind === "model") {
      models.set(step.id, step);
      const all = [...models.values()];
      const text = all
        .map((s) => s.reasoning)
        .filter(Boolean)
        .join("\n\n");
      thought.hidden = !text && step.status !== "running";
      updateMarkdown(thoughtsBody, text);
      const active = all.some((s) => s.status === "running");
      thought.dataset.status = active ? "running" : step.status;
      thoughtsTitle.textContent = active
        ? "思考中…"
        : `思考 · ${(all.reduce((total, s) => total + (s.duration || 0), 0) / 1000).toFixed(1)}s`;
      summarize();
      return;
    }
    tools.hidden = false;
    let call = calls.get(step.id);
    if (!call) {
      const row = node("details"),
        title = node("summary"),
        body = node("div"),
        input = node("pre"),
        output = node("pre");
      row.className = "chat-tool";
      body.className = "chat-step-body";
      body.append(node("small", "输入"), input, node("small", "结果"), output);
      row.append(title, body);
      toolsBody.append(row);
      call = { step, row, title, input, output };
      calls.set(step.id, call);
    }
    const previous = call.step;
    call.step = step;
    call.row.dataset.status = step.status;
    call.title.textContent = `${labels[step.name] || step.name} · ${states[step.status]}${step.duration === undefined ? "" : ` · ${(step.duration / 1000).toFixed(1)}s`}`;
    if (previous.input !== step.input || !call.input.textContent)
      call.input.textContent = pretty(step.input || "{}");
    if (previous.output !== step.output || !call.output.textContent)
      call.output.textContent = step.output
        ? pretty(step.output)
        : step.status === "receiving"
          ? "正在接收参数，尚未执行…"
          : ["error", "stopped"].includes(step.status)
            ? "本次调用未完成。"
            : "等待结果…";
    const all = [...calls.values()].map((item) => item.step);
    const active = all.find((s) => ["receiving", "running"].includes(s.status));
    const failed = all.some((s) => s.status === "error");
    const stopped = all.some((s) => s.status === "stopped");
    tools.dataset.status = active
      ? "running"
      : failed
        ? "error"
        : stopped
          ? "stopped"
          : "complete";
    toolsTitle.textContent = `工具调用 · ${all.length} 次${active ? " · " + (labels[active.name] || active.name) + " · " + states[active.status] : failed ? " · 有失败" : stopped ? " · 已中断" : " · 完成"}`;
    summarize();
  };
}
