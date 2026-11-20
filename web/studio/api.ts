import type { Workspace } from "../../src/studio/language";
import { assetUrl } from "../../src/studio/assets";
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
  }
>();
export function onConnectionChange(listener: (connected: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function connection(value: boolean) {
  online = value;
  listeners.forEach((fn) => fn(value));
}
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
  online = false;
  for (const item of pending.values()) item.reject(new Error("工作区已切换。"));
  pending.clear();
  worker = new Worker(assetUrl("workspace.worker.js"), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error));
    else item.resolve(data.result);
  };
  worker.onerror = (event) => {
    connection(false);
    for (const item of pending.values()) {
      const error = new Error(event.message || "工作区未能启动。");
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
export async function api<T = Workspace>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  return rpc<T>(url, method, data ?? {});
}

export function createWorkspaceLoader(options: {
  selected(): string;
  loaded(state: Workspace): void;
  failed(error: unknown): void;
  read?: (url: string) => Promise<Workspace>;
}) {
  let pending = false;
  let queued = false;
  const read = options.read || api<Workspace>;
  return async () => {
    if (pending) {
      queued = true;
      return;
    }
    pending = true;
    try {
      do {
        queued = false;
        const selected = options.selected();
        const [domain, question, draft] = selected.split("|");
        try {
          const next = await read(
            `/api/state?domain=${encodeURIComponent(domain)}${question ? "&question=" + encodeURIComponent(question) + (draft ? "&draft=true" : "") : ""}`,
          ).catch((error) => {
            if (error.message === "领域不存在。") return read("/api/state");
            throw error;
          });
          if (selected === options.selected()) options.loaded(next);
        } catch (error) {
          if (selected === options.selected()) options.failed(error);
        }
      } while (queued);
    } finally {
      pending = false;
    }
  };
}
