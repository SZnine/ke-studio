/** All paths are relative to the folder explicitly selected by the user. */
let root: FileSystemDirectoryHandle;
export function mount(handle: FileSystemDirectoryHandle) {
  root = handle;
}
export const randomUUID = () => crypto.randomUUID();
export const path = {
  join: (...parts: string[]) => parts.filter(Boolean).join("/"),
  basename: (name: string) => name.replaceAll("\\", "/").split("/").at(-1)!,
  dirname: (name: string) => name.split("/").slice(0, -1).join("/"),
};
function segments(name: string) {
  const parts = name.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === "." || p.includes("\\")))
    throw new Error("文件路径无效。");
  return parts;
}
async function directory(name: string, create = false) {
  if (!root) throw new Error("请先选择保存文件夹。");
  let handle = root;
  for (const part of segments(name))
    handle = await handle.getDirectoryHandle(part, { create });
  return handle;
}
function missing(error: unknown): never {
  if ((error as DOMException).name === "NotFoundError")
    throw Object.assign(new Error("文件不存在。"), { code: "ENOENT" });
  throw error;
}
export const files = {
  async readFile(name: string, _encoding = "utf8"): Promise<string> {
    try {
      const parent = await directory(path.dirname(name));
      return await (
        await (await parent.getFileHandle(path.basename(name))).getFile()
      ).text();
    } catch (error) {
      return missing(error);
    }
  },
  async readdir(name: string): Promise<string[]> {
    try {
      const names: string[] = [];
      for await (const key of (await directory(name)).keys()) names.push(key);
      return names;
    } catch (error) {
      return missing(error);
    }
  },
  async unlink(name: string) {
    const parent = await directory(path.dirname(name));
    await parent.removeEntry(path.basename(name));
  },
  async appendFile(name: string, text: string, _encoding = "utf8") {
    await atomic(name, ((await optional(name)) || "") + text);
  },
  async snapshot(name: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    async function visit(folder: FileSystemDirectoryHandle, prefix: string) {
      for await (const [key, handle] of folder.entries()) {
        if (handle.kind === "directory")
          await visit(handle, prefix + key + "/");
        else result[prefix + key] = await (await handle.getFile()).text();
      }
    }
    try {
      await visit(await directory(name), "");
    } catch (error) {
      if ((error as DOMException).name !== "NotFoundError") throw error;
    }
    return result;
  },
};
export async function optional(name: string) {
  try {
    return await files.readFile(name);
  } catch (error) {
    if ((error as { code: string }).code === "ENOENT") return undefined;
    throw error;
  }
}
/** createWritable commits the replacement on close, so partial writes stay invisible. */
export async function atomic(name: string, text: string) {
  const parent = await directory(path.dirname(name), true);
  const handle = await parent.getFileHandle(path.basename(name), {
    create: true,
  });
  const stream = await handle.createWritable();
  try {
    await stream.write(text);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
}
