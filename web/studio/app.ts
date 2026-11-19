import "./style.css";
import { initStorage } from "./storage";
import "katex/dist/katex.min.css";
import { buildId } from "../../src/studio/assets";
import { createDomains } from "./domains";
import { createEditor } from "./editor";
import { createAnnotations } from "./annotations";
import { createCoke } from "./coke";
import { createDrafts } from "./drafts";
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
} from "./api";
import type { Question, QuestionSummary } from "../../src/studio/language";
import { createCoManager } from "./co-manager";
import {
  $,
  button,
  download,
  field,
  message,
  modal,
  node,
  notify,
  run,
} from "./ui";
import type { Workspace } from "../../src/studio/language";
import type { Change } from "../../src/studio/store";

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
let tab = "questions";
let loadingDocument = false;
let documentDirty = false;
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
        catalogChanged: boolean;
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
      if (result.catalogChanged) void refreshWorkspace();
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
  const isSyntax = (issue: { code?: string }) =>
    issue.code === "syntax" || issue.code === "separator";
  const errors = issues.filter((i) => i.severity === "error");
  const syntax = errors.filter(isSyntax).length;
  const service = errors.filter((i) => i.code === "service").length;
  const semantic = errors.length - syntax - service;
  const warnings = issues.length - errors.length;
  $("#diagnostic-count").textContent = issues.length
    ? "检查 · " +
      [
        syntax ? `${syntax} 处语法` : "",
        semantic ? `${semantic} 处语义` : "",
        service ? "检查服务异常" : "",
        warnings ? `${warnings} 个提示` : "",
      ]
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
    const label =
      issue.severity === "warning"
        ? "提示"
        : isSyntax(issue)
          ? "语法"
          : issue.code === "service"
            ? "服务"
            : "语义";
    item.append(
      node("span", `L${position.lineNumber} · ${label}`),
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
  if (documentDirty) {
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
  if (!documentDirty) $("#save-status").textContent = "已保存到本机";
  domainTree.render();
  const banks = $<HTMLSelectElement>("#bank-select");
  banks.replaceChildren(
    ...next.storage.banks.map((bank) => new Option(bank.name, bank.id)),
  );
  banks.value = next.storage.bank;
  $("#storage-settings").textContent = "保存位置 · " + next.storage.folder;
  if (tab === "library") renderLibrary();
  questions.render();
  drafts.render();
  coke.sync();
  if (next.question && tab === "editor") void showIssues();
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
  for (const name of ["questions", "editor", "library", "coke"])
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
    if (state?.question) void showIssues();
  }
  $("#view-title").textContent =
    (
      {
        library: "CO 字典",
        coke: "人工标准例",
      } as Record<string, string>
    )[value] || "";
  $("#question-breadcrumb").textContent =
    value === "editor" && state?.question ? " / " + state.question.number : "";
  if (value === "coke" && state) void run(coke.load);
  if (value === "library" && state) renderLibrary();
  if (state) questions.render();
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
click("#quick-co-search", async () => {
  await saveDocument();
  setTab("library");
  $<HTMLInputElement>("#library-search").focus();
});
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

const co = createCoManager({
  workspace: () => state,
  click,
  refresh: async () => applyState(await api(workspaceUrl())),
});
function renderLibrary() {
  co.render();
}

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
        change.file === "domain-delete" ||
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
    `${state?.domain.id || (localStorage.getItem("ke-studio.domain") === "common" ? "default" : localStorage.getItem("ke-studio.domain")) || "default"}|${state?.question?.id || ""}|${state?.question?.draft ? "draft" : ""}|${state?.storage.bank || ""}`,
  loaded(next) {
    $("#service-alert").hidden = true;
    const first = !state;
    if (
      first ||
      reconnecting ||
      next.language.revision !== state.language.revision ||
      next.editorContext !== state.editorContext ||
      JSON.stringify([
        next.libraries,
        next.usedEntries,
        next.domains,
        next.usage,
        next.questions,
        next.drafts,
        next.question,
      ]) !==
        JSON.stringify([
          state.libraries,
          state.usedEntries,
          state.domains,
          state.usage,
          state.questions,
          state.drafts,
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
    void run(async () => {
      await api("/api/catalog");
      await refreshWorkspace();
    });
  },
});
