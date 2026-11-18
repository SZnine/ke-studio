import "./style.css";
import { initStorage } from "./storage";
import "katex/dist/katex.min.css";
import { buildId } from "../../src/studio/assets";
import { createDomains } from "./domains";
import { createEditor } from "./editor";
import { createAnnotations } from "./annotations";
import { createChat } from "./chat";
import { createCoke } from "./coke";
import { createDrafts } from "./drafts";
import { createReviews } from "./reviews";
import { initTheme } from "./theme";
import { initLayout } from "./layout";
import { createQuestions } from "./questions";
import { exportKe } from "../../src/studio/question-text";
import { changeFiles } from "./change-files";
import {
  api,
  createWorkspaceLoader,
  offlineMessage,
  onConnectionChange,
  isConnected,
} from "./api";
import type {
  Entry,
  Question,
  QuestionSummary,
} from "../../src/studio/language";
import { createDictionary } from "./dictionary";
import { displayType as typeLabel } from "../../src/studio/language";
import { entryKey, Workspace } from "../../src/studio/language";
import type { Change } from "../../src/studio/store";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};
const field = (form: HTMLFormElement, name: string) =>
  form.elements.namedItem(name) as HTMLInputElement;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
let toastTimer: ReturnType<typeof setTimeout>;
function notify(text: string, error = false) {
  const toast = $("#toast");
  (document.querySelector("dialog[open]") || document.body).append(toast);
  toast.textContent = text;
  toast.hidden = false;
  toast.classList.toggle("error", error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      toast.hidden = true;
    },
    error ? 7000 : 3000,
  );
}
const run = (action: () => unknown | Promise<unknown>) =>
  Promise.resolve()
    .then(action)
    .catch((error) => notify(message(error), true));
function button(
  text: string,
  action: () => unknown | Promise<unknown>,
  className = "text-button",
) {
  const element = node("button", text, className);
  element.type = "button";
  element.addEventListener("click", () => void run(action));
  return element;
}
function click(selector: string, action: () => unknown | Promise<unknown>) {
  $(selector).addEventListener(
    "click",
    () =>
      void run(() => {
        if (!state) throw new Error(offlineMessage);
        return action();
      }),
  );
}
function download(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = node("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function formError(selector: string, error?: unknown) {
  const element = $(selector);
  element.hidden = !error;
  element.textContent = error ? message(error) : "";
}
function modal(selector: string) {
  $(selector)
    .querySelectorAll<HTMLElement>(".form-error")
    .forEach((e) => {
      e.hidden = true;
    });
  $(selector).querySelector("form")?.reset();
  $<HTMLDialogElement>(selector).showModal();
}
document
  .querySelectorAll("[data-close]")
  .forEach((element) =>
    element.addEventListener("click", () => element.closest("dialog")!.close()),
  );

initTheme();
initLayout();
const ke = createEditor($("#editor"), () => {
  void run(saveDocument);
});
const annotations = createAnnotations({
  workspace: () => state,
  ke,
  changed: changedQuestion,
  save: () => void run(saveDocument),
  notify,
  apply: (next) => applyState(next),
});
let state: Workspace;
const displayType = (type: string) =>
  typeLabel(type, state?.language.editor.typeSyntax);
let tab = "questions",
  languageFile = "ke.langium",
  draftRevision = "";
let languageDraft: Record<string, string> = {},
  languageDirty = false,
  loadingDocument = false,
  documentDirty = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
async function saveDocument() {
  if (!state?.question || loadingDocument) return;
  clearTimeout(saveTimer);
  const domain = state.domain.id,
    question = questionDraft(),
    isDraft = !!state.question.draft;
  if (!documentDirty) return saveChain;
  $("#save-status").textContent = "保存中…";
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      const result = await api<{
        question: Question;
        questions: QuestionSummary[];
        drafts: QuestionSummary[];
      }>(isDraft ? "/api/drafts" : "/api/questions", "PUT", {
        domain,
        question,
      });
      if (state.domain.id === domain) {
        state.questions = result.questions;
        state.drafts = result.drafts;
      }
      if (
        state.domain.id === domain &&
        state.question?.id === question.id &&
        JSON.stringify(questionDraft()) === JSON.stringify(question)
      ) {
        state.question = result.question;
        documentDirty = false;
        $("#save-status").textContent = "已保存到本机";
        $("#document-name").textContent = result.question.number + ".ke";
        $("#question-breadcrumb").textContent =
          tab === "editor" ? " / " + result.question.number : "";
        questions.render();
        drafts.render();
        chat.sync();
      }
    });
  return saveChain;
}
function questionDraft() {
  return {
    id: state.question!.id,
    number: $<HTMLInputElement>("#question-number").value,
    ...annotations.snapshot(),
    notes: $<HTMLTextAreaElement>("#question-notes").value,
    ke: ke.getText(),
    coScope: state.question?.draft
      ? $<HTMLSelectElement>("#draft-scope").value
      : undefined,
  };
}
const workspaceUrl = (
  domain = state.domain.id,
  id = state.question?.id,
  draft = !!state.question?.draft,
) =>
  `/api/state?domain=${encodeURIComponent(domain)}${id ? "&question=" + encodeURIComponent(id) + (draft ? "&draft=true" : "") : ""}`;
async function openQuestion(id: string, draft = false) {
  await saveDocument();
  applyState(await api(workspaceUrl(state.domain.id, id, draft)), true);
  setTab("editor");
}
async function showIssues() {
  const issues = await ke.diagnostics(),
    container = $("#issues");
  if (!issues) return;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  $("#diagnostic-count").textContent = issues.length
    ? "检查 · " +
      [errors ? `${errors} 个问题` : "", warnings ? `${warnings} 个提示` : ""]
        .filter(Boolean)
        .join(" · ")
    : ke.getText().trim()
      ? "检查 · 通过"
      : "检查";
  container.replaceChildren();
  for (const issue of issues) {
    const row = node("div", "", "issue-row");
    const item = button(
      "",
      () => ke.jump(issue.start),
      `issue ${issue.severity}`,
    );
    const position = ke.editor.getModel()!.getPositionAt(issue.start);
    item.append(
      node("span", `L${position.lineNumber}`),
      node("span", issue.message, "issue-message"),
    );
    row.append(item);
    if (issue.replacement !== undefined) {
      const version = ke.editor.getModel()!.getVersionId();
      row.append(
        button(
          "修复",
          () => {
            if (version !== ke.editor.getModel()!.getVersionId())
              return showIssues();
            ke.applyEdit(issue.start, issue.end, issue.replacement);
          },
          "text-button issue-action",
        ),
      );
    }
    if (issue.detail) {
      const details = node("details", "", "issue-detail");
      details.append(node("summary", "详情"), node("pre", issue.detail));
      row.append(details);
    }
    container.append(row);
  }
}
$("#toggle-issues").addEventListener("click", () => {
  const collapsed = $(".diagnostics").classList.toggle("collapsed");
  $("#toggle-issues").textContent = collapsed ? "展开" : "收起";
  $("#toggle-issues").setAttribute("aria-expanded", String(!collapsed));
});
let diagnosticTimer: ReturnType<typeof setTimeout>;
function changedQuestion() {
  if (loadingDocument) return;
  if (state && !state.question) return;
  documentDirty = true;
  if (!state) {
    $("#save-status").textContent = "未连接，内容暂存在编辑器";
    return;
  }
  $("#save-status").textContent = "待保存";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void run(saveDocument), 600);
  clearTimeout(diagnosticTimer);
  diagnosticTimer = setTimeout(showIssues, 450);
}
ke.editor.onDidChangeModelContent(changedQuestion);
for (const id of ["question-number", "question-notes"])
  $("#" + id).addEventListener("input", changedQuestion);
ke.editor.onDidChangeCursorPosition(({ position }) => {
  $("#cursor").textContent =
    `Ln ${position.lineNumber}, Col ${position.column}`;
});
window.addEventListener("beforeunload", (event) => {
  if (documentDirty || languageDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function applyState(next: Workspace, loadDocument = false) {
  if (
    !loadDocument &&
    state?.domain.id === next.domain.id &&
    !next.question &&
    [...next.questions, ...next.drafts].some((q) => q.id === state.question?.id)
  )
    next = { ...next, question: state.question };
  state = next;
  if (!languageDirty) {
    languageDraft = structuredClone(next.language.files);
    draftRevision = next.language.revision;
  }
  const alert = $("#language-alert");
  alert.hidden = !next.language.error && !next.language.update?.error;
  alert.textContent = next.language.error
    ? "语言编译未通过，请在“语言”页修复。当前保持上次可用版本。"
    : next.language.update?.error
      ? "默认语言更新未通过，仍使用本地规则；请到“语言”页查看。"
      : "";
  loadingDocument = true;
  try {
    ke.setWorkspace(next, loadDocument);
    if (loadDocument) annotations.load(next.question);
  } finally {
    loadingDocument = false;
  }
  if (loadDocument) {
    documentDirty = false;
    $<HTMLInputElement>("#question-number").value = next.question?.number || "";
    $<HTMLTextAreaElement>("#question-notes").value =
      next.question?.notes || "";
  }
  $("#domain-title").textContent = next.domain.name;
  $("#document-name").textContent = (next.question?.number || "题目") + ".ke";
  $("#version").textContent = "KE Studio " + next.version;
  $("#version").title = "构建 " + buildId;
  $("#model-status").classList.toggle("ready", next.model.hasKey);
  if (!documentDirty) $("#save-status").textContent = "已保存到本机";
  domainTree.render();
  const banks = $<HTMLSelectElement>("#bank-select");
  banks.replaceChildren(
    ...next.storage.banks.map((bank) => new Option(bank.name, bank.id)),
  );
  banks.value = next.storage.bank;
  $("#storage-settings").textContent = "保存位置 · " + next.storage.folder;
  renderLibrary();
  questions.render();
  drafts.render();
  reviews.render();
  renderLanguage();
  chat.sync();
  coke.sync();
  showIssues();
  if (tab === "editor" && !state.question) setTab("questions");
  $("#question-breadcrumb").textContent =
    tab === "editor" && state.question ? " / " + state.question.number : "";
}
const domainTree = createDomains({
  workspace: () => state,
  save: saveDocument,
  apply: applyState,
  tab: setTab,
  notify,
});
function setTab(value: string) {
  tab = value;
  for (const name of ["questions", "editor", "library", "language", "coke"])
    $(`#panel-${name}`).hidden = name !== value;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.tab === value ||
        (value === "editor" && item.dataset.tab === "questions"),
    );
    if (item.dataset.tab === value) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  if (value === "editor") {
    ke.editor.layout();
    annotations.source.layout();
  }
  $("#view-title").textContent =
    (
      {
        library: "CO 字典",
        coke: "人工标准例",
        language: "语言定义",
      } as Record<string, string>
    )[value] || "";
  $("#question-breadcrumb").textContent =
    value === "editor" && state?.question ? " / " + state.question.number : "";
  if (value === "coke" && state) void run(coke.load);
  if (state) {
    questions.render();
    chat.sync();
  }
}
const questions = createQuestions({
  workspace: () => state,
  save: saveDocument,
  open: openQuestion,
  apply: applyState,
  tab: setTab,
  notify,
});
const drafts = createDrafts({
  workspace: () => state,
  save: saveDocument,
  open: openQuestion,
  apply: applyState,
  tab: setTab,
  notify,
});
const coke = createCoke({
  workspace: () => state,
  text: () => ke.getText(),
  notify,
});
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((item) =>
  item.addEventListener(
    "click",
    () =>
      void run(async () => {
        await saveDocument();
        setTab(item.dataset.tab!);
      }),
  ),
);
const completionStyle = $<HTMLSelectElement>("#completion-style");
const savedCompletion = localStorage.getItem("ke-studio.completion");
completionStyle.value =
  !savedCompletion || savedCompletion === "name" ? "smart" : savedCompletion;
function updateCompletion() {
  const value = completionStyle.value;
  ke.setOptions({
    enabled: value !== "off",
    callStyle:
      value === "smart"
        ? "smart"
        : value === "arguments"
          ? "arguments"
          : value === "parentheses"
            ? "parentheses"
            : "name",
  });
  localStorage.setItem("ke-studio.completion", value);
}
completionStyle.addEventListener("change", updateCompletion);
updateCompletion();
click("#format-document", () => ke.format());
click("#export-document", async () => {
  await saveDocument();
  if (state.question)
    download(state.question.number + ".ke", exportKe(state.question));
});

const managedDomain = () => {
  const value = $<HTMLSelectElement>("#dictionary-source").value;
  return state.libraries.some((lib) => lib.id === value)
    ? value
    : state.domain.id;
};
const currentLibrary = () =>
  state.libraries.find((library) => library.id === managedDomain())!;
const dictionary = createDictionary({
  workspace: () => state,
  edit: editEntry,
  notify,
  core: () => {
    languageFile = "core.keh";
    renderLanguage();
    setTab("language");
  },
  remove: async (entry, source) => {
    await api("/api/library", "PUT", {
      domain: source,
      edits: [{ key: entryKey(entry), entry: null }],
      reason: `删除 CO：${entry.name}`,
    });
    applyState(await api(workspaceUrl()));
    notify("已删除，可从修改历史恢复。");
  },
});
const renderLibrary = () => dictionary.render();
let editing: Entry | undefined,
  editingSource = "";
const entryForm = $<HTMLFormElement>("#entry-form");
function parameterRow(value = { name: "", type: "", description: "" }) {
  const row = node("div", "", "parameter-row");
  for (const [key, placeholder] of [
    ["name", "参数名"],
    ["type", "类型"],
    ["description", "说明"],
  ]) {
    const input = node("input");
    input.dataset.param = key;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    input.value = (value as any)[key] || "";
    input.required = key === "name";
    row.append(input);
  }
  row.append(button("×", () => row.remove(), "icon-button"));
  $("#parameters").append(row);
}
function entryKindChanged() {
  const kind = field(entryForm, "kind").value;
  entryForm.querySelectorAll<HTMLElement>("[data-kind]").forEach((element) => {
    element.hidden = !element.dataset.kind!.split(" ").includes(kind);
  });
  field(entryForm, "type").required = !["concept", "operator"].includes(kind);
  $("#parameters")
    .querySelectorAll<HTMLInputElement>("input")
    .forEach((input) => {
      input.required = kind === "operator" && input.dataset.param === "name";
    });
  $("#return-label").textContent = kind === "operator" ? "输出类型" : "类型";
}
function editEntry(entry?: Entry, source = managedDomain()) {
  editing = entry;
  editingSource = source;
  modal("#entry-dialog");
  $("#entry-title").textContent = entry ? "编辑 CO" : "新增 CO";
  for (const key of [
    "kind",
    "name",
    "label",
    "parent",
    "description",
    "returnDescription",
  ])
    field(entryForm, key).value =
      (entry as any)?.[key] || (key === "kind" ? "concept" : "");
  field(entryForm, "aliases").value = entry?.aliases?.join(", ") || "";
  field(entryForm, "type").value = entry ? displayType(entry.type) : "";
  $("#parameters").replaceChildren();
  for (const param of entry?.params || [])
    parameterRow({
      name: param.name,
      type: displayType(param.type),
      description: param.description || "",
    });
  entryKindChanged();
  field(entryForm, "name").focus();
}
field(entryForm, "kind").addEventListener("change", entryKindChanged);
click("#add-entry", () => editEntry());
click("#add-parameter", () => parameterRow());
entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError("#entry-error");
  const submit = entryForm.querySelector<HTMLButtonElement>("[type=submit]")!;
  submit.disabled = true;
  try {
    const value = (key: string) => field(entryForm, key).value.trim();
    const kind = value("kind") as Entry["kind"];
    const params = [...$("#parameters").querySelectorAll(".parameter-row")].map(
      (row) =>
        Object.fromEntries(
          [...row.querySelectorAll<HTMLInputElement>("input")].map((input) => [
            input.dataset.param!,
            input.value.trim(),
          ]),
        ) as Entry["params"][number],
    );
    const entry: Entry = {
      ...editing,
      kind,
      name: value("name"),
      type: kind === "concept" ? value("name") : value("type"),
      label: value("label"),
      aliases: value("aliases")
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      description: value("description"),
      parent: kind === "concept" ? value("parent") || undefined : undefined,
      params: kind === "operator" ? params : [],
      returnDescription:
        kind === "operator" ? value("returnDescription") : undefined,
      contract: kind === "operator" ? editing?.contract : undefined,
    };
    await api("/api/library", "PUT", {
      domain: editingSource,
      edits: [{ key: editing ? entryKey(editing) : undefined, entry }],
    });
    applyState(await api(workspaceUrl()));
    $<HTMLDialogElement>("#entry-dialog").close();
    notify(
      entry.kind === "operator" &&
        (!entry.type || entry.params.some((p) => !p.type))
        ? "已保存为待完善 CO。"
        : "CO 已保存，补全已更新。",
    );
  } catch (error) {
    formError("#entry-error", error);
  } finally {
    submit.disabled = false;
  }
});
click("#import-library", () => $<HTMLInputElement>("#library-file").click());
click("#export-library", () =>
  download(currentLibrary().name + ".keh", currentLibrary().text),
);
$<HTMLInputElement>("#library-file").addEventListener(
  "change",
  (event) =>
    void run(async () => {
      const input = event.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = "";
      if (!file) return;
      await api("/api/library", "PUT", {
        domain: managedDomain(),
        text: await file.text(),
        reason: `导入：${file.name}`,
      });
      applyState(await api(workspaceUrl()));
      notify("已导入，原库保留在修改历史中。");
    }),
);
$("#import-library").title =
  "用 .keh 文件替换当前领域库，原内容保留在修改历史中";
click("#count-usage", () => $<HTMLInputElement>("#usage-folder").click());
$<HTMLInputElement>("#usage-folder").addEventListener(
  "change",
  (event) =>
    void run(async () => {
      const input = event.target as HTMLInputElement;
      const files = [...(input.files || [])].filter(
        (file) =>
          file.name.toLowerCase().endsWith(".ke") &&
          file.webkitRelativePath.split("/").length === 2,
      );
      input.value = "";
      if (!files.length) throw new Error("所选文件夹的第一层没有 KE 文件。");
      const data = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          text: await file.text(),
        })),
      );
      applyState(
        await api("/api/usage", "PUT", {
          domain: state.domain.id,
          files: data,
        }),
      );
      notify(`已统计 ${files.length} 个文件的实际引用，声明不计入。`);
    }),
);

function renderLanguage() {
  if (!state) return;
  const select = $<HTMLSelectElement>("#language-file");
  select.replaceChildren();
  const primary = [
    "ke.langium",
    "profile.ts",
    "semantic.ts",
    "core.keh",
    "manifest.json",
  ];
  const names = [
    ...primary,
    ...Object.keys(languageDraft).filter((name) => !primary.includes(name)),
  ];
  for (const name of names) {
    const option = node("option", name);
    option.value = name;
    select.append(option);
  }
  if (!(languageFile in languageDraft)) languageFile = "ke.langium";
  select.value = languageFile;
  const source = $<HTMLTextAreaElement>("#language-source");
  if (source.value !== languageDraft[languageFile])
    source.value = languageDraft[languageFile] || "";
  $("#language-state").textContent =
    state.language.error ||
    (languageDirty
      ? "有未应用的修改"
      : `已应用 · KE ${state.language.version}`);
  $("#language-state").classList.toggle("error", !!state.language.error);
  const update = state.language.update;
  if (update?.updated.length)
    $("#language-state").textContent +=
      `\n已同步默认文件：${update.updated.join("、")}`;
  if (update?.customized.length)
    $("#language-state").textContent +=
      `\n保留本地修改：${update.customized.join("、")}`;
  if (update?.error)
    $("#language-state").textContent += `\n更新未应用：${update.error}`;
  $<HTMLButtonElement>("#save-language").disabled = !languageDirty;
}
$("#language-file").addEventListener("change", () => {
  languageFile = $<HTMLSelectElement>("#language-file").value;
  renderLanguage();
});
$("#language-source").addEventListener("input", () => {
  languageDraft[languageFile] =
    $<HTMLTextAreaElement>("#language-source").value;
  languageDirty = true;
  chat.sync();
  $("#language-state").textContent = "有未应用的修改";
  $<HTMLButtonElement>("#save-language").disabled = false;
});
click("#save-language", async () => {
  const next = await api("/api/language", "PUT", {
    domain: state.domain.id,
    files: languageDraft,
    revision: draftRevision,
  });
  languageDirty = false;
  applyState(next);
  notify("语言与声明库已更新。");
});
click("#reload-language", async () => {
  if (languageDirty && !confirm("放弃未应用的源码修改，重新读取本地文件？"))
    return;
  languageDirty = false;
  applyState(
    await api(`/api/state?domain=${encodeURIComponent(state.domain.id)}`),
  );
});
click("#update-language", async () => {
  if (languageDirty)
    return notify("请先应用或撤销语言草稿，再同步默认文件。", true);
  const next = await api<Workspace>("/api/language/update", "POST", {
    domain: state.domain.id,
    questionId: state.question?.id,
    draft: state.question?.draft,
  });
  applyState(next);
  const update = next.language.update;
  notify(
    update?.error ||
      (update?.updated.length
        ? `已同步 ${update.updated.length} 个默认语言文件。`
        : "默认语言已是当前版本；本地修改保持原样。"),
    !!update?.error,
  );
});
click("#export-language", () =>
  download("ke-language.json", JSON.stringify(languageDraft, null, 2)),
);
click("#import-language", () =>
  $<HTMLInputElement>("#language-import").click(),
);
$("#language-import").addEventListener(
  "change",
  (event) =>
    void run(async () => {
      const input = event.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = "";
      if (!file) return;
      const text = await file.text();
      if (file.name === "ke-language.json") languageDraft = JSON.parse(text);
      else if (file.name in languageDraft) {
        languageDraft[file.name] = text;
        languageFile = file.name;
      } else
        throw new Error(
          "请选择同名的语言源码文件，或导出的 ke-language.json。",
        );
      languageDirty = true;
      renderLanguage();
      chat.sync();
    }),
);

const modelForm = $<HTMLFormElement>("#model-form");
click("#model-settings", () => {
  modal("#model-dialog");
  field(modelForm, "baseUrl").value = state.model.baseUrl;
  field(modelForm, "model").value = state.model.model;
  field(modelForm, "maxTokens").value = state.model.maxTokens?.toString() || "";
  field(modelForm, "apiKey").placeholder = state.model.hasKey
    ? "已配置，留空保持不变"
    : "填写 API 密钥";
});
modelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError("#model-error");
  const submit = modelForm.querySelector<HTMLButtonElement>("[type=submit]")!;
  submit.disabled = true;
  try {
    const key = field(modelForm, "apiKey").value.trim();
    applyState(
      await api("/api/model", "PUT", {
        domain: state.domain.id,
        baseUrl: field(modelForm, "baseUrl").value,
        model: field(modelForm, "model").value,
        maxTokens: field(modelForm, "maxTokens").value
          ? Number(field(modelForm, "maxTokens").value)
          : undefined,
        apiKey: field(modelForm, "clearKey").checked ? "" : key || undefined,
      }),
    );
    field(modelForm, "apiKey").value = "";
    $<HTMLDialogElement>("#model-dialog").close();
    notify("模型配置已保存。");
  } catch (error) {
    formError("#model-error", error);
  } finally {
    submit.disabled = false;
  }
});

function diff(before: string, after: string) {
  const grid = node("div", "", "diff");
  for (const [label, text, className] of [
    ["修改前", before, "before"],
    ["修改后", after, "after"],
  ]) {
    const column = node("div", "", className);
    column.append(node("label", label), node("pre", text || "（空）"));
    grid.append(column);
  }
  return grid;
}
const chat = createChat({
  workspace: () => state,
  context: () => ({
    tab,
    file: tab === "language" ? languageFile : undefined,
    languageDraft: languageDirty,
    questionId:
      tab === "editor" && !state.question?.draft
        ? state.question?.id
        : undefined,
    draftId:
      tab === "editor" && state.question?.draft ? state.question.id : undefined,
  }),
  save: saveDocument,
  apply: (next) => {
    const same = next.question?.id === state.question?.id;
    if (!same) next = { ...next, question: state.question };
    applyState(next, same && !documentDirty);
  },
  request: api,
  diff,
  settings: () => $("#model-settings").click(),
});
const reviews = createReviews({
  workspace: () => state,
  apply: applyState,
  diff,
  notify,
});
click("#ask-model", () => chat.open());
click("#quick-co", () => chat.quick("co-update"));
click("#quick-conflicts", () => chat.quick("resolve-conflicts"));
click("#history", async () => {
  const changes = await api<Change[]>("/api/history");
  modal("#history-dialog");
  const list = $("#history-list");
  list.replaceChildren();
  if (!changes.length) list.append(node("p", "还没有修改记录。", "muted"));
  for (const change of changes) {
    const item = node("details", "", "history-item"),
      summary = node("summary", change.reason);
    summary.append(
      node("small", new Date(change.time).toLocaleString("zh-CN")),
    );
    item.append(summary);
    let expanded = false;
    item.addEventListener("toggle", () => {
      if (!item.open || expanded) return;
      expanded = true;
      item.append(node("p", change.file, "muted small"));
      for (const file of changeFiles(change))
        item.append(node("strong", file.file), diff(file.before, file.after));
      if (
        ["language", "update", "domain-delete"].includes(change.file) ||
        /^(libraries|documents|questions|drafts)\//.test(change.file)
      )
        item.append(
          button("恢复到修改前", async () => {
            await saveDocument();
            const next = await api("/api/history/restore", "POST", {
              id: change.id,
              domain: state.domain.id,
              questionId: state.question?.id,
              draft: state.question?.draft,
            });
            applyState(next, !documentDirty);
            $<HTMLDialogElement>("#history-dialog").close();
            notify("已恢复，并记录本次恢复操作。");
          }),
        );
    });
    list.append(item);
  }
});
$("#bank-select").addEventListener(
  "change",
  () =>
    void run(async () => {
      await saveDocument();
      applyState(
        await api("/api/banks", "PUT", {
          id: $<HTMLSelectElement>("#bank-select").value,
        }),
        true,
      );
      setTab("questions");
    }),
);
click("#add-bank", () => modal("#bank-dialog"));
$("#bank-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    await saveDocument();
    applyState(
      await api("/api/banks", "POST", {
        name: field($<HTMLFormElement>("#bank-form"), "name").value,
      }),
      true,
    );
    $<HTMLDialogElement>("#bank-dialog").close();
    setTab("questions");
  });
});

let reconnecting = false;
const refreshWorkspace = createWorkspaceLoader({
  selected: () =>
    `${state?.domain.id || (localStorage.getItem("ke-studio.domain") === "common" ? "default" : localStorage.getItem("ke-studio.domain")) || "default"}|${state?.question?.id || ""}|${state?.question?.draft ? "draft" : ""}`,
  loaded(next) {
    $("#service-alert").hidden = true;
    const first = !state;
    if (
      first ||
      reconnecting ||
      next.language.revision !== state.language.revision ||
      next.language.error !== state.language.error ||
      JSON.stringify([
        next.libraries,
        next.model,
        next.domains,
        next.usage,
        next.questions,
        next.drafts,
        next.proposals,
        next.question,
      ]) !==
        JSON.stringify([
          state.libraries,
          state.model,
          state.domains,
          state.usage,
          state.questions,
          state.drafts,
          state.proposals,
          state.question,
        ])
    ) {
      applyState(next, !documentDirty);
    }
    reconnecting = false;
    if (documentDirty) void run(saveDocument);
    else $("#save-status").textContent = "已保存到本机";
  },
  failed(error) {
    reconnecting = true;
    $("#service-alert").hidden = false;
    $("#service-message").textContent = message(error);
    $("#save-status").textContent = "本地工作区未连接";
  },
});
onConnectionChange((connected) => {
  $("#service-alert").hidden = connected;
  if (!connected) {
    reconnecting = true;
    $("#service-message").textContent = offlineMessage;
    $("#save-status").textContent = "本地工作区未连接";
  }
});
$("#reconnect").addEventListener("click", refreshWorkspace);
void initStorage({
  save: saveDocument,
  apply: (next) => {
    applyState(next, true);
    setTab("questions");
  },
});
setInterval(() => {
  if (isConnected() && !document.hidden) void refreshWorkspace();
}, 3000);

document.addEventListener("visibilitychange", () => {
  if (isConnected() && !document.hidden) void refreshWorkspace();
});
