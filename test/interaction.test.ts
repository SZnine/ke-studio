import { afterEach, describe, expect, it, vi } from "vitest";
import { completeModel, ModelRequest } from "../src/studio/model";
import { splitKe, exportKe } from "../src/studio/question-text";
import { proseBlocks } from "../web/studio/prose";
import { renderMarkdown } from "../web/studio/markdown";

afterEach(() => vi.unstubAllGlobals());

it("renders Markdown headings, lists, tables, links and literal KE code during streaming", () => {
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

it("treats model HTML and unsafe links as text instead of executable markup", () => {
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

it("preserves each streamed paragraph across tool rounds and avoids repeating the final answer", () => {
  const first = {
    id: "first",
    kind: "model" as const,
    name: "模型处理",
    started: 1,
    status: "complete" as const,
    explanation: "先检查定义。",
  };
  const final = { ...first, id: "final", explanation: "建议已生成。" };
  const message = {
    id: "turn",
    role: "assistant" as const,
    content: "",
    steps: [first],
  };
  expect(proseBlocks(message)).toEqual([{ id: "first", text: "先检查定义。" }]);
  message.steps.push(final);
  message.content = "建议已生成。";
  expect(proseBlocks(message)).toEqual([
    { id: "first", text: "先检查定义。" },
    { id: "final", text: "建议已生成。" },
  ]);
  message.content = "连接中断，可以继续。";
  expect(proseBlocks(message).at(-1)?.text).toBe("连接中断，可以继续。");
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

const options = (): ModelRequest => ({
  settings: { baseUrl: "https://api.deepseek.com", model: "fixture" },
  key: "fixture-key",
  messages: [{ role: "user", content: "fixture" }],
  tools: [],
  signal: new AbortController().signal,
  onText: vi.fn(),
});
function stream(frames: unknown[], done = true) {
  const text =
    ": heartbeat\r\n\r\n" +
    frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("") +
    (done ? "data: [DONE]\r\n\r\n" : "");
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Break both Unicode code points and SSE delimiters across network chunks.
        for (let offset = 0; offset < bytes.length; offset += 3)
          controller.enqueue(bytes.slice(offset, offset + 3));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("Model adapter", () => {
  it("assembles streamed text and fragmented tool arguments before dispatch", async () => {
    const request = options();
    request.onReasoning = vi.fn();
    const argumentsSeen: string[] = [];
    request.onToolCall = (call) => argumentsSeen.push(call.function.arguments);
    const fetcher = vi.fn().mockResolvedValue(
      stream([
        {
          choices: [
            {
              delta: { reasoning_content: "先检查标准例。", content: "先读取" },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: "定义。",
                tool_calls: [
                  {
                    index: 0,
                    id: "call1",
                    function: { name: "read_", arguments: '{"query":' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { name: "library", arguments: '"测量"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await completeModel(request);
    expect(result.content).toBe("先读取定义。");
    expect(result.tool_calls).toEqual([
      {
        id: "call1",
        type: "function",
        function: { name: "read_library", arguments: '{"query":"测量"}' },
      },
    ]);
    expect(
      vi
        .mocked(request.onText)
        .mock.calls.map(([text]) => text)
        .join(""),
    ).toBe("先读取定义。");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty("max_tokens");
    expect(argumentsSeen).toEqual(['{"query":', '{"query":"测量"}']);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(result.reasoning_content).toBe("先检查标准例。");
    expect(request.onReasoning).toHaveBeenCalledWith("先检查标准例。");
  });

  it("does not accept a truncated tool request as a complete command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        stream(
          [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call1",
                        function: { name: "update_library", arguments: "{" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
          false,
        ),
      ),
    );
    await expect(completeModel(options())).rejects.toThrow("提前结束");
  });

  it("distinguishes model credentials and transport failures from local service failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 401 }))
        .mockRejectedValueOnce(
          new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
        ),
    );
    await expect(completeModel(options())).rejects.toThrow(
      "模型接口返回 HTTP 401",
    );
    await expect(completeModel(options())).rejects.toThrow(
      "模型接口连接失败（ECONNREFUSED）",
    );
  });

  it("uses an explicit output limit and reports length without completing a tool call", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      stream([
        {
          choices: [
            {
              delta: {
                content: "保留这段文字",
                tool_calls: [
                  {
                    index: 0,
                    id: "partial",
                    function: {
                      name: "update_library",
                      arguments: '{"edits":[',
                    },
                  },
                ],
              },
              finish_reason: "length",
            },
          ],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetcher);
    const request = options();
    request.settings.maxTokens = 32768;
    await expect(completeModel(request)).rejects.toThrow("已达到模型输出上限");
    expect(request.onText).toHaveBeenCalledWith("保留这段文字");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).max_tokens).toBe(32768);
  });

  it("keeps long active streams alive, including provider heartbeat comments", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal!;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                feed = controller;
                signal.addEventListener("abort", () =>
                  controller.error(signal.reason),
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      }),
    );
    try {
      const response = completeModel(options());
      const encoder = new TextEncoder();
      for (let tick = 0; tick < 3; tick++) {
        await vi.advanceTimersByTimeAsync(119000);
        expect(signal.aborted).toBe(false);
        feed.enqueue(encoder.encode(": keep-alive\n\n"));
        await vi.advanceTimersByTimeAsync(0);
      }
      feed.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ),
      );
      feed.close();
      expect((await response).content).toBe("完成");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an idle connection separately from user cancellation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () =>
              reject(init.signal!.reason),
            );
          }),
      ),
    );
    try {
      const assertion = expect(completeModel(options())).rejects.toThrow(
        "连续两分钟未传来数据",
      );
      await vi.advanceTimersByTimeAsync(120000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes cancellation to the active model request", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => reject(init.signal!.reason),
              {
                once: true,
              },
            );
          }),
      ),
    );
    const request = completeModel({ ...options(), signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
