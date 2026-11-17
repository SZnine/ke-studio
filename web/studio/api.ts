import type { Workspace } from "../../src/studio/language";
export const offlineMessage =
  "请先选择保存文件夹，允许 KE Studio 读写本地工作区。";
let worker: Worker;
let sequence = 0;
let online = false;
const listeners = new Set<(connected: boolean) => void>();
const pending = new Map<
  number,
  {
    resolve(value: any): void;
    reject(error: Error): void;
    stream?: ReadableStreamDefaultController<Uint8Array>;
  }
>();
const encoder = new TextEncoder();
export function onConnectionChange(listener: (connected: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function connection(value: boolean) {
  online = value;
  listeners.forEach((fn) => fn(value));
}
export const isConnected = () => online;
function rpc<T>(url: string, method: string, input: unknown): Promise<T> {
  if (!online) return Promise.reject(new Error(offlineMessage));
  const id = ++sequence;
  const result = new Promise<T>((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  worker.postMessage({ id, method, url, input });
  return result;
}
export function connectionError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
function startWorker() {
  worker?.terminate();
  for (const item of pending.values()) item.reject(new Error("工作区已切换。"));
  pending.clear();
  worker = new Worker(new URL("workspace.worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    if (data.event) {
      item.stream?.enqueue(
        encoder.encode("data: " + JSON.stringify(data.event) + "\n\n"),
      );
      return;
    }
    pending.delete(data.id);
    if (item.stream) {
      if (data.error)
        item.stream.enqueue(
          encoder.encode(
            "data: " +
              JSON.stringify({ type: "error", error: data.error }) +
              "\n\n",
          ),
        );
      item.stream.close();
    } else if (data.error) item.reject(new Error(data.error));
    else item.resolve(data.result);
  };
  worker.onerror = (event) => {
    connection(false);
    for (const item of pending.values()) {
      const error = new Error(event.message || "工作区未能启动。");
      item.stream?.error(error);
      item.reject(error);
    }
    pending.clear();
  };
}
export async function connect(
  handle: FileSystemDirectoryHandle,
): Promise<Workspace> {
  startWorker();
  const id = ++sequence;
  const result = new Promise<Workspace>((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  worker.postMessage({ id, method: "MOUNT", handle });
  const state = await result;
  connection(true);
  return state;
}
/** The editor and agent run locally in a worker. Only model calls go onto the network. */
export async function request(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (!online) throw new Error(offlineMessage);
  const id = ++sequence,
    method = init?.method || "GET",
    input = init?.body ? JSON.parse(String(init.body)) : {};
  if (method === "POST" && url === "/api/chat") {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        pending.set(id, { resolve() {}, reject() {}, stream: controller });
      },
      cancel() {
        pending.delete(id);
        worker.postMessage({
          id: ++sequence,
          method: "POST",
          url: "/api/chat/stop",
          input: { domain: input.domain },
        });
      },
    });
    worker.postMessage({ id, method, url, input });
    init?.signal?.addEventListener(
      "abort",
      () => {
        worker.postMessage({
          id: ++sequence,
          method: "POST",
          url: "/api/chat/stop",
          input: { domain: input.domain },
        });
      },
      { once: true },
    );
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  return Response.json(await rpc(url, method, input));
}
export async function api<T = Workspace>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  return rpc<T>(url, method, data ?? {});
}

/** Keep retrying after the initial failure; a failed boot is not an initialized editor. */
export function createWorkspaceLoader(options: {
  selected(): string;
  loaded(state: Workspace): void;
  failed(error: unknown): void;
  read?: (url: string) => Promise<Workspace>;
}) {
  let pending = false;
  const read = options.read || api<Workspace>;
  return async () => {
    if (pending) return;
    pending = true;
    const selected = options.selected();
    try {
      const [domain, question, draft] = selected.split("|");
      const next = await read(
        `/api/state?domain=${encodeURIComponent(domain)}${question ? "&question=" + encodeURIComponent(question) + (draft ? "&draft=true" : "") : ""}`,
      ).catch((error) => {
        if (error.message === "领域不存在。") return read("/api/state");
        throw error;
      });
      if (selected === options.selected()) options.loaded(next);
    } catch (error) {
      options.failed(error);
    } finally {
      pending = false;
    }
  };
}
