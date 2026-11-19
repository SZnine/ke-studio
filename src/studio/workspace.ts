import { atomic, files, optional, randomUUID } from "./files";

export interface Bank {
  id: string;
  name: string;
}
export interface LocalWorkspace {
  id: string;
  banks: Bank[];
  activeBank: string;
}
/** The publisher's template is copied once. Later releases never replace local files. */
export async function initializeWorkspace(
  template: Record<string, string>,
): Promise<LocalWorkspace> {
  const saved = await optional("ke-workspace.json");
  if (saved) return JSON.parse(saved);
  const entries = Object.entries(template);
  for (let start = 0; start < entries.length; start += 12)
    await Promise.all(
      entries.slice(start, start + 12).map(async ([name, text]) => {
        if ((await optional(name)) === undefined) await atomic(name, text);
      }),
    );
  const workspace: LocalWorkspace = {
    id: randomUUID(),
    banks: [{ id: "default", name: "我的题库" }],
    activeBank: "default",
  };
  await atomic("ke-workspace.json", JSON.stringify(workspace, null, 2));
  return workspace;
}
export async function workspaceInfo(): Promise<LocalWorkspace> {
  return JSON.parse(await files.readFile("ke-workspace.json"));
}
export async function selectBank(id: string) {
  const data = await workspaceInfo();
  if (!data.banks.some((bank) => bank.id === id))
    throw new Error("题库不存在。");
  data.activeBank = id;
  await atomic("ke-workspace.json", JSON.stringify(data, null, 2));
  return data;
}
export async function addBank(name: string) {
  const data = await workspaceInfo();
  if (!name.trim()) throw new Error("请输入题库名称。");
  const bank = { id: randomUUID(), name: name.trim() };
  data.banks.push(bank);
  data.activeBank = bank.id;
  await atomic("ke-workspace.json", JSON.stringify(data, null, 2));
  return data;
}
