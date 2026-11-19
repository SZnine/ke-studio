import { mount, path } from "./files";
import { assetUrl } from "./assets";
import {
  initializeWorkspace,
  addBank,
  selectBank,
  workspaceInfo,
} from "./workspace";
import { LanguageEngine } from "./engine";
import { Store } from "./store";
import { questionSummary } from "./questions";
import { splitKe } from "./question-text";
import { CoCatalog } from "./co-catalog";

let store: Store,
  folder = "";
const engine = new LanguageEngine();
const catalog = new CoCatalog();
async function openWorkspace() {
  try {
    await workspaceInfo();
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    const response = await fetch(assetUrl("initial.json"));
    if (!response.ok) throw new Error("无法读取初始题库。");
    await initializeWorkspace(await response.json());
  }
}
async function openBank() {
  const local = await workspaceInfo();
  store = new Store("banks/" + local.activeBank, engine, folder, catalog);
  return store.workspace(await store.firstDomain());
}
async function route(method: string, address: string, input: any) {
  if (!store) throw new Error("请先选择保存文件夹。");
  const url = new URL(address, "https://local/"),
    route = method + " " + url.pathname;
  if (route === "POST /api/banks") {
    await addBank(input.name);
    return openBank();
  }
  if (route === "PUT /api/banks") {
    await selectBank(input.id);
    return openBank();
  }
  // Editor requests already carry a prepared scope. Do not read files or join the write queue.
  if (route === "POST /api/analyze" || route === "POST /api/format")
    return store.inspectEditor(input, route.endsWith("/format"));
  if (route === "GET /api/catalog") {
    await store.indexCo();
    return null;
  }
  const selected =
    url.searchParams.get("domain") ||
    input.domain ||
    (await store.firstDomain());
  const domain = input.domain || selected;
  switch (route) {
    case "GET /api/state":
      return store.workspace(
        selected,
        url.searchParams.get("question") || undefined,
        url.searchParams.get("draft") === "true",
      );
    case "POST /api/co/declaration":
      return engine.service.renderEntry(input.entry);
    case "GET /api/questions":
      await store.domain(selected);
      return store.questions.list(selected);
    case "GET /api/coke":
      return {
        cases: await store.coke(selected),
        checks: (await store.checkCoke()).filter((r) => r.domain === selected),
      };
    case "GET /api/history": {
      const all = await store.history(),
        id = url.searchParams.get("id");
      return id ? all.find((item) => item.id === id) : all.slice(-50).reverse();
    }
  }
  return store.mutate(async () => {
    switch (route) {
      case "PUT /api/coke":
        return {
          cases: await store.saveCoke(domain, input.case, input.remove),
          checks: (await store.checkCoke()).filter((r) => r.domain === domain),
        };
      case "POST /api/drafts/publish": {
        const question = await store.publishDraft(
          domain,
          input.id,
          input.number,
          input.target,
        );
        return store.workspace(input.target || domain, question.id);
      }
      case "POST /api/drafts":
      case "PUT /api/drafts":
      case "POST /api/questions":
      case "PUT /api/questions": {
        const result = await store.saveQuestion(
          domain,
          input.question,
          method === "POST",
          undefined,
          route.endsWith("/drafts"),
        );
        return {
          question: result.question,
          catalogChanged: result.catalogChanged,
          questions: (await store.questions.list(domain)).map(questionSummary),
          drafts: (await store.drafts.list(domain)).map(questionSummary),
        };
      }
      case "DELETE /api/drafts":
      case "DELETE /api/questions":
        await store.deleteQuestion(domain, input.id, route.endsWith("/drafts"));
        break;
      case "POST /api/questions/import": {
        await store.domain(domain);
        const items = input.files
          ? input.files.map((f: any) => ({
              number: path.basename(f.name).replace(/\.ke$/i, ""),
              ...splitKe(f.text),
            }))
          : input.questions;
        if (!Array.isArray(items) || !items.length)
          throw new Error("请选择 KE 文件或题库 JSON。");
        const seen = new Set(
          (await store.questions.list(domain)).map((q) =>
            q.number.toLowerCase(),
          ),
        );
        for (const item of items) {
          const number = String(item.number || "").trim();
          if (!number || seen.has(number.toLowerCase()))
            throw new Error(
              `题号 ${number || "（空）"} 重复或无效，本次未导入。`,
            );
          seen.add(number.toLowerCase());
          if (typeof item.ke !== "string")
            throw new Error("题目缺少 KE 内容。");
          item.number = number;
        }
        for (const item of items)
          await store.saveQuestion(
            domain,
            {
              ...item,
              prompt: String(item.prompt || ""),
              notes: String(item.notes || ""),
            },
            true,
            "导入题目",
          );
        break;
      }
      case "POST /api/domains":
        return store.workspace(
          (await store.addDomain(input.name, input.parent)).id,
        );
      case "PUT /api/domains":
        await store.updateDomain(input.id, input);
        return store.workspace(domain);
      case "DELETE /api/domains": {
        const removed = await store.deleteDomain(input.id);
        return store.workspace(
          removed.some((d) => d.id === domain)
            ? (await store.domains()).find((d) => d.id !== "common")?.id ||
                "common"
            : domain,
        );
      }
      case "PUT /api/library":
        if (typeof input.text === "string")
          await store.saveLibrary(
            domain,
            input.text,
            input.reason || "导入 CO 库",
          );
        else await store.editLibrary(domain, input.edits, input.reason);
        break;
      case "POST /api/co":
        return store.createCo(
          domain,
          input.entry,
          input.questionId,
          !!input.draft,
        );
      case "PUT /api/usage":
        await store.recount(domain, input.files);
        break;
      case "POST /api/history/restore":
        await store.restore(input.id);
        break;
      default:
        throw new Error("接口不存在。");
    }
    return store.workspace(domain, input.questionId, !!input.draft);
  });
}
self.onmessage = async ({ data }) => {
  const { id, method, url, input = {} } = data;
  try {
    if (method === "MOUNT") {
      mount(data.handle);
      folder = data.handle.name;
      await Promise.all([openWorkspace(), engine.load()]);
      self.postMessage({ id, result: await openBank() });
    } else self.postMessage({ id, result: await route(method, url, input) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
