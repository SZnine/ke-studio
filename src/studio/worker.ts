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
import { Assistant } from "./assistant";
import { questionSummary } from "./questions";
import { splitKe } from "./question-text";
import type { ChatEvent } from "./language";
import type { PublishedLanguage } from "./language-defaults";

let store: Store,
  engine: LanguageEngine,
  assistant: Assistant,
  folder = "";
let publishedLanguage: PublishedLanguage;
const turns = new Set<Promise<unknown>>();
async function openBank() {
  assistant?.stopAll();
  await Promise.allSettled([...turns]);
  const local = await workspaceInfo();
  engine = new LanguageEngine();
  store = new Store("banks/" + local.activeBank, engine, local.id, folder);
  await store.initialize();
  await engine.refresh();
  await store.updateDefaultLanguage(publishedLanguage);
  assistant = new Assistant(store);
  return store.workspace(
    (await store.domains()).find((d) => d.id !== "common")?.id || "common",
  );
}
async function route(
  method: string,
  address: string,
  input: any,
  emit: (event: ChatEvent) => void,
) {
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
  if (route === "GET /api/state") await store.mutate(() => engine.refresh());
  const first =
    (await store.domains()).find((d) => d.id !== "common")?.id || "common";
  const selected = url.searchParams.get("domain") || first;
  const domain = input.domain || selected;
  switch (route) {
    case "GET /api/state":
      return store.workspace(
        selected,
        url.searchParams.get("question") || undefined,
        url.searchParams.get("draft") === "true",
      );
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
    case "GET /api/chat":
      return (await store.chat(selected)).map(
        ({ trace, ...message }) => message,
      );
    case "DELETE /api/chat":
      await assistant.clear(selected);
      return [];
    case "POST /api/chat/stop":
      assistant.stop(domain);
      return { stopping: true };
    case "POST /api/chat": {
      const turn = assistant.turn(
        domain,
        input.message,
        input.context || {},
        emit,
        new AbortController().signal,
      );
      turns.add(turn);
      try {
        await turn;
      } finally {
        turns.delete(turn);
      }
      return;
    }
  }
  return store.mutate(async () => {
    switch (route) {
      case "PUT /api/coke":
        return {
          cases: await store.saveCoke(domain, input.case, input.remove),
          checks: (await store.checkCoke()).filter((r) => r.domain === domain),
        };
      case "POST /api/proposals/decide":
        await store.reviews.decide(domain, input.id, input.selected || []);
        break;
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
      case "PUT /api/language":
        if (input.revision && input.revision !== engine.active?.revision)
          throw new Error("语言已更新，请重新读取后修改。");
        await store.saveLanguage(input.files, input.reason);
        break;
      case "POST /api/language/update":
        await store.updateDefaultLanguage(publishedLanguage);
        break;
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
      case "PUT /api/model":
        await store.saveModel(
          {
            baseUrl: input.baseUrl.trim(),
            model: input.model.trim(),
            maxTokens: input.maxTokens,
          },
          input.apiKey,
        );
        break;
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
  const emit = (event: ChatEvent) => self.postMessage({ id, event });
  try {
    if (method === "MOUNT") {
      mount(data.handle);
      folder = data.handle.name;
      const [template, known] = await Promise.all([
        fetch(assetUrl("initial.json")).then((r) => r.json()),
        fetch(assetUrl("language-defaults.json")).then((r) => r.json()),
      ]);
      publishedLanguage = {
        files: Object.fromEntries(
          Object.entries(template as Record<string, string>)
            .filter(([name]) => name.startsWith("shared/language/"))
            .map(([name, text]) => [
              name.slice("shared/language/".length),
              text,
            ]),
        ),
        known,
      };
      await initializeWorkspace(template);
      self.postMessage({ id, result: await openBank() });
    } else
      self.postMessage({ id, result: await route(method, url, input, emit) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
