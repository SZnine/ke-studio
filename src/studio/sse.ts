import { EventSourceParserStream } from "eventsource-parser/stream";

/** Shared framing for provider streams and the local chat connection. */
export async function* events(response: Response, onActivity?: () => void) {
  if (!response.body) throw new Error("服务没有返回响应内容。");
  const reader = response.body
    .pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          onActivity?.();
          controller.enqueue(chunk);
        },
      }),
    )
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value.data;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
