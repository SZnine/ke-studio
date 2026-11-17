import { events } from "./sse";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface ModelRequest {
  settings: { baseUrl: string; model: string; maxTokens?: number };
  key: string;
  messages: ModelMessage[];
  tools: unknown[];
  signal: AbortSignal;
  onText(text: string): void;
  onReasoning?(text: string): void;
  onToolCall?(call: ToolCall, index: number): void;
}

export class ModelOutputLimit extends Error {
  constructor(readonly partial: ModelMessage) {
    super(
      "已达到模型输出上限，收到的内容已保留，不完整的工具调用未执行。请继续分批处理，或在模型设置中调整输出上限。",
    );
  }
}

/** OpenAI-compatible transport. It knows no KE files, tools or UI state. */
export async function completeModel(
  request: ModelRequest,
): Promise<ModelMessage> {
  const { settings, key, signal } = request;
  const endpoint = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const activity = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => idle.abort(new DOMException("Stream idle", "TimeoutError")),
      120000,
    );
  };
  activity();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.any([signal, idle.signal]),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: request.messages.map((message) =>
          new URL(endpoint).hostname === "api.deepseek.com" &&
          message.role === "assistant"
            ? { reasoning_content: "", ...message }
            : message,
        ),
        tools: request.tools,
        stream: true,
        ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
        ...(new URL(endpoint).hostname === "api.deepseek.com"
          ? { thinking: { type: "enabled" } }
          : {}),
      }),
    });
    if (!response.ok) {
      const hint =
        response.status === 401
          ? "请检查模型设置中的 API 密钥。"
          : response.status === 429
            ? "额度或请求频率受限，请稍后重试。"
            : "请检查接口地址和模型名称。";
      throw new Error(`模型接口返回 HTTP ${response.status}。${hint}`);
    }
    const message: ModelMessage = { role: "assistant", content: "" };
    const calls = new Map<number, ToolCall>();
    let finish = "";
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      for await (const text of events(response, activity)) {
        if (text === "[DONE]") break;
        const data = JSON.parse(text),
          choice = data.choices?.[0];
        if (data.error)
          throw new Error("模型接口在响应中报告错误，请检查模型设置。");
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) {
          message.content += delta.content;
          request.onText(delta.content);
        }
        if (delta.reasoning_content) {
          message.reasoning_content =
            (message.reasoning_content || "") + delta.reasoning_content;
          request.onReasoning?.(delta.reasoning_content);
        }
        for (const part of delta.tool_calls || []) {
          if (!Number.isInteger(part.index))
            throw new Error("模型工具调用缺少流索引。");
          const call = calls.get(part.index) || {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          if (part.id) call.id = part.id;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments)
            call.function.arguments += part.function.arguments;
          calls.set(part.index, call);
          request.onToolCall?.(call, part.index);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (calls.size)
        message.tool_calls = [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call);
    } else {
      // Some compatible servers return a complete JSON response even when stream=true.
      const data = (await response.json()) as any,
        choice = data.choices?.[0];
      if (!choice?.message) throw new Error("模型接口没有返回消息。");
      Object.assign(message, choice.message);
      finish = choice.finish_reason;
      if (message.content) request.onText(message.content);
      if (message.reasoning_content)
        request.onReasoning?.(message.reasoning_content);
      message.tool_calls?.forEach((call, index) =>
        request.onToolCall?.(call, index),
      );
    }
    if (!finish)
      throw new Error("模型响应连接提前结束，本轮未执行不完整的工具调用。");
    if (finish === "length") throw new ModelOutputLimit(message);
    if (!["stop", "tool_calls"].includes(finish))
      throw new Error(`模型提前结束（${finish}），本轮未执行工具调用。`);
    if (
      message.tool_calls?.some(
        (call) =>
          !call.id ||
          !call.function?.name ||
          typeof call.function.arguments !== "string",
      )
    )
      throw new Error("模型返回的工具调用不完整。");
    return message;
  } catch (error) {
    if (signal.aborted) throw error;
    if (idle.signal.aborted)
      throw new Error(
        "模型接口连续两分钟未传来数据，连接已中断。已收到的内容会保留，可以继续。",
      );
    if (error instanceof TypeError) {
      const code = (error.cause as { code?: string })?.code;
      throw new Error(
        `模型接口连接失败${code ? `（${code}）` : ""}，请检查接口地址和网络。`,
        {
          cause: error,
        },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}
