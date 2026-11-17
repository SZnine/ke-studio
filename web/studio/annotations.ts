import * as monaco from "monaco-editor/editor/editor.api.js";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { api } from "./api";
import { declarationDrag } from "./declaration-drag";
import { updateMarkdown } from "./markdown";
import { completionSearchRank } from "../../src/completion-search";
import {
  displayType,
  entryKey,
  type Entry,
  type Question,
  type TextAnnotation,
  type Workspace,
} from "../../src/studio/language";
import type { createEditor } from "./editor";

interface Host {
  workspace(): Workspace;
  ke: ReturnType<typeof createEditor>;
  changed(): void;
  save(): void;
  apply(state: Workspace): void;
  notify(message: string, error?: boolean): void;
}
type Kind = TextAnnotation["kind"];
type Evidence = Pick<TextAnnotation, "start" | "end" | "quote">;
const titles = { concept: "概念", operator: "算子" };
const letters = { concept: "C", operator: "O" };
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.querySelector<T>("#" + id)!;

/** One selected CO is a reusable brush. Source text and evidence stay in the question. */
export function createAnnotations(host: Host) {
  const source = monaco.editor.create($("question-prompt"), {
    language: "plaintext",
    theme: "ke-site",
    automaticLayout: true,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
    fontSize: 15,
    lineHeight: 30,
    wordWrap: "on",
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "none",
    padding: { top: 16, bottom: 16 },
    quickSuggestions: false,
    wordBasedSuggestions: "off",
    dragAndDrop: false,
    overviewRulerLanes: 0,
    readOnly: true,
    scrollbar: { verticalScrollbarSize: 6 },
    ariaLabel: "题目原文，划选文字关联当前概念或算子",
  });
  const model = source.getModel()!,
    ke = host.ke.editor,
    keModel = ke.getModel()!;
  const marks = source.createDecorationsCollection(),
    selectionMark = source.createDecorationsCollection();
  const picker = $("annotation-picker"),
    search = $<HTMLInputElement>("annotation-search");
  const form = $<HTMLFormElement>("annotation-create");
  document.body.append(picker);
  let annotations: TextAnnotation[] = [],
    mode: Kind = "concept",
    choices: Entry[] = [],
    active = 0;
  let loading = false,
    busy = false,
    editing = false,
    activeTool = false;
  let selected: Evidence | undefined,
    currentMark: TextAnnotation | undefined,
    disposePosition: (() => void) | undefined;
  const brushes: Partial<Record<Kind, string>> = {};
  const range = (start: number, end: number) =>
    monaco.Range.fromPositions(
      model.getPositionAt(start),
      model.getPositionAt(end),
    );
  const identify = () => {
    const s = host.workspace();
    return `${s.storage.bank}:${s.domain.id}:${s.question?.id}`;
  };
  const allEntries = () => [
    ...new Map(
      [
        ...host.workspace().coreEntries,
        ...host.workspace().libraries.flatMap((l) => l.entries),
      ].map((e) => [entryKey(e), e]),
    ).values(),
  ];
  const brush = () =>
    allEntries().find((entry) => entryKey(entry) === brushes[mode]);
  const resolveMark = (mark: TextAnnotation) => {
    const entries = allEntries().filter(
      (entry) => entry.kind === mark.kind && entry.name === mark.name,
    );
    return (
      entries.find(
        (entry) =>
          entry.kind !== "operator" ||
          JSON.stringify(entry.params.map((p) => p.type)) ===
            JSON.stringify(mark.params),
      ) || (entries.length === 1 ? entries[0] : undefined)
    );
  };
  const error = (message = "") => {
    $("annotation-error").textContent = message;
    $("annotation-error").hidden = !message;
  };
  const inspect = (extra: object) => {
    const s = host.workspace();
    return api<any>("/api/analyze", "POST", {
      domain: s.domain.id,
      questionId: s.question?.id,
      draft: s.question?.draft,
      editorContext: s.editorContext,
      text: host.ke.getText(),
      completion: { enabled: false },
      ...extra,
    });
  };
  const drag = declarationDrag(host.ke, inspect, identify, host.notify);
  function close() {
    picker.hidden = true;
    disposePosition?.();
    disposePosition = undefined;
    selected = undefined;
    currentMark = undefined;
    selectionMark.clear();
    error();
  }
  function positionPicker() {
    disposePosition?.();
    const evidence = selected;
    const reference = evidence
      ? {
          contextElement: $("question-prompt"),
          getBoundingClientRect: () => {
            const bounds = $("question-prompt").getBoundingClientRect();
            const at = source.getScrolledVisiblePosition(
              model.getPositionAt(evidence.end),
            );
            return new DOMRect(
              bounds.left + (at?.left || 12),
              bounds.top + (at?.top || 0),
              1,
              at?.height || 30,
            );
          },
        }
      : document.querySelector<HTMLElement>(`[data-annotation="${mode}"]`)!;
    const update = () => {
      void computePosition(reference, picker, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(9), flip(), shift({ padding: 12 })],
      }).then(({ x, y }) =>
        Object.assign(picker.style, { left: `${x}px`, top: `${y}px` }),
      );
    };
    const stop = autoUpdate(reference, picker, update);
    const scroll = source.onDidScrollChange(update);
    disposePosition = () => {
      stop();
      scroll.dispose();
    };
  }
  function capture(): Evidence | undefined {
    const selection = source.getSelection();
    if (
      !selection ||
      selection.isEmpty() ||
      !model.getValueInRange(selection).trim()
    )
      return;
    return {
      start: model.getOffsetAt(selection.getStartPosition()),
      end: model.getOffsetAt(selection.getEndPosition()),
      quote: model.getValueInRange(selection),
    };
  }
  function updateTools() {
    document
      .querySelectorAll<HTMLButtonElement>("[data-annotation]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(activeTool && button.dataset.annotation === mode),
        ),
      );
    const entry = brush();
    $("annotation-brush").hidden = !activeTool || !entry;
    $("annotation-brush").dataset.kind = mode;
    $("annotation-brush").firstElementChild!.textContent = entry
      ? entry.label || entry.name
      : "";
    const raw = editing || activeTool;
    $("question-prompt").hidden = !raw;
    $("question-preview").hidden = raw;
    if (!raw) updateMarkdown($("question-preview"), source.getValue());
    else source.layout();
    $("edit-source").textContent = raw ? "预览" : "编辑原文";
    $("edit-source").setAttribute("aria-pressed", String(editing));
    $("annotation-hint").textContent = !activeTool
      ? editing
        ? "可直接编辑、删除原文"
        : "Markdown 与公式预览 · C / O 划选标注"
      : entry
        ? `划选即标注 · ${entry.name}${entry.draft ? " · 待完善" : ""}`
        : "划选文字后选择 CO · 再次点击工具可取消";
    source.updateOptions({ readOnly: !editing });
  }
  function renderMarks() {
    marks.set(
      annotations.map((mark) => ({
        range: range(mark.start, mark.end),
        options: {
          inlineClassName: "evidence-" + mark.kind,
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          hoverMessage: [
            {
              value: `${letters[mark.kind]} · **${mark.name}**${mark.draft ? " · 待完善" : ""}`,
            },
            { value: "```ke\n" + mark.declaration + "\n```" },
            { value: "点击查看或更换关联" },
          ],
        },
      })),
    );
    $("annotation-count").textContent = String(annotations.length);
    $("annotation-count").title = `${annotations.length} 处标注`;
  }
  function readMarks() {
    return annotations.flatMap((mark, index) => {
      const current = marks.getRange(index);
      return !current || model.getValueInRange(current) !== mark.quote
        ? []
        : [
            {
              ...mark,
              start: model.getOffsetAt(current.getStartPosition()),
              end: model.getOffsetAt(current.getEndPosition()),
            },
          ];
    });
  }
  source.onDidChangeModelContent(() => {
    if (loading) return;
    annotations = readMarks();
    renderMarks();
    close();
    host.changed();
  });
  function setMode(kind: Kind) {
    if (busy) return;
    activeTool = !(activeTool && mode === kind);
    mode = kind;
    editing = !activeTool;
    close();
    updateTools();
    source.focus();
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-annotation]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setMode(button.dataset.annotation as Kind),
      ),
    );
  for (const [kind, key] of [
    ["concept", monaco.KeyCode.KeyC],
    ["operator", monaco.KeyCode.KeyO],
  ] as const) {
    source.addCommand(monaco.KeyMod.Alt | key, () => setMode(kind));
    source.addCommand(key, () => setMode(kind), "editorReadonly");
  }
  source.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, host.save);
  $("question-preview").addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "c" || key === "o") {
      event.preventDefault();
      setMode(key === "c" ? "concept" : "operator");
    }
  });
  source.addCommand(monaco.KeyCode.Escape, () => {
    if (picker.hidden && activeTool) {
      activeTool = false;
      editing = true;
      updateTools();
    }
    close();
    source.setPosition(source.getPosition()!);
  });
  $("edit-source").addEventListener("click", () => {
    if (busy) return;
    editing = !(editing || activeTool);
    activeTool = false;
    close();
    updateTools();
    source.focus();
  });
  $("annotation-close").addEventListener("click", close);
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      source.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      !picker.hidden &&
      !picker.contains(event.target as Node) &&
      !(event.target as HTMLElement).closest(".annotation-palette")
    )
      close();
  });
  function show(view: "search" | "create" | "detail") {
    $("annotation-search-view").hidden = view !== "search";
    form.hidden = view !== "create";
    $("annotation-detail").hidden = view !== "detail";
    picker.hidden = false;
    error();
    $("annotation-quote").textContent = selected?.quote || "";
    $("annotation-quote").hidden = !selected;
    if (selected)
      selectionMark.set([
        {
          range: range(selected.start, selected.end),
          options: { inlineClassName: "evidence-selection" },
        },
      ]);
    positionPicker();
  }
  function openSearch(evidence?: Evidence, mark?: TextAnnotation) {
    close();
    selected = evidence;
    currentMark = mark;
    $("annotation-title").textContent = `选择${titles[mode]}`;
    $("annotation-new").textContent = `＋ 新建${titles[mode]}`;
    search.value = "";
    renderChoices();
    show("search");
    search.focus();
  }
  $("annotation-clear").addEventListener("click", () => {
    if (busy) return;
    delete brushes[mode];
    activeTool = false;
    editing = true;
    close();
    updateTools();
    source.focus();
  });
  function showDetail(mark: TextAnnotation) {
    close();
    mode = mark.kind;
    selected = { ...mark };
    currentMark = mark;
    updateTools();
    $("annotation-title").textContent = `${letters[mark.kind]} · ${mark.name}`;
    const definition = $("annotation-definition");
    definition.replaceChildren();
    const code = document.createElement("pre");
    code.textContent = mark.declaration;
    definition.append(code);
    const entry = resolveMark(mark),
      pending = entry ? !!entry.draft : !!mark.draft;
    const hint = document.createElement("p");
    hint.textContent = pending
      ? "待完善 CO · 补齐签名后可生成声明"
      : "拖入 KE 编辑区可定位或补齐声明";
    definition.append(hint);
    definition.draggable = !pending && !!entry;
    definition.ondragstart = (event) =>
      drag.start(
        event,
        entry
          ? {
              ...mark,
              type: entry.type,
              params: entry.params.map((p) => p.type),
            }
          : mark,
      );
    definition.ondragend = drag.clear;
    $<HTMLButtonElement>("annotation-locate").disabled = !!pending || !entry;
    show("detail");
  }
  source.onMouseUp((event) => {
    if (!activeTool || editing || busy) return;
    const evidence = capture();
    if (evidence) {
      const existing = annotations.find(
        (mark) => mark.start === evidence.start && mark.end === evidence.end,
      );
      if (existing) {
        showDetail(existing);
        return;
      }
      const entry = brush();
      if (entry) void apply(entry, evidence);
      else openSearch(evidence);
    } else if (event.target.position) {
      const at = model.getOffsetAt(event.target.position);
      const mark = annotations.find(
        (mark) => mark.start <= at && at < mark.end,
      );
      if (mark) showDetail(mark);
    }
  });
  function highlightChoice() {
    $("annotation-results")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button, i) => {
        button.classList.toggle("active", i === active);
        button.setAttribute("aria-selected", String(i === active));
      });
  }
  function renderChoices() {
    const state = host.workspace(),
      query = search.value.trim();
    choices = allEntries()
      .filter((entry) => entry.kind === mode)
      .map((entry) => ({
        entry,
        rank: completionSearchRank(
          query,
          entry.name,
          [entry.label || "", ...(entry.aliases || [])],
          [entry.description || ""],
        ),
      }))
      .filter((item) => item.rank >= 0)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (state.usage[b.entry.name] || 0) - (state.usage[a.entry.name] || 0) ||
          a.entry.name.localeCompare(b.entry.name),
      )
      .slice(0, 8)
      .map((item) => item.entry);
    active = 0;
    const list = $("annotation-results");
    list.replaceChildren();
    const type = (value: string) =>
      displayType(value, state.language.editor.typeSyntax);
    for (const [index, entry] of choices.entries()) {
      const button = document.createElement("button");
      button.className = "annotation-result";
      button.setAttribute("role", "option");
      const icon = document.createElement("span");
      icon.className = "co-icon co-" + mode;
      icon.textContent = letters[mode];
      const text = document.createElement("span"),
        label = document.createElement("strong"),
        detail = document.createElement("small");
      label.textContent = entry.label || entry.name;
      detail.textContent =
        entry.name +
        (entry.kind === "operator"
          ? `(${entry.params.map((p) => type(p.type)).join(", ")}) → ${type(entry.type) || "未填写"}${entry.draft ? " · 待完善" : ""}`
          : entry.parent
            ? " · " + entry.parent
            : "");
      text.append(label, detail);
      button.append(icon, text);
      button.addEventListener("click", () => void choose(index));
      list.append(button);
    }
    if (!choices.length) {
      const empty = document.createElement("p");
      empty.className = "annotation-form-hint";
      empty.textContent = "没有匹配的 CO，可直接新建";
      list.append(empty);
    }
    highlightChoice();
  }
  search.addEventListener("input", renderChoices);
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(
        0,
        Math.min(
          choices.length - 1,
          active + (event.key === "ArrowDown" ? 1 : -1),
        ),
      );
      highlightChoice();
      $("annotation-results")
        .querySelector(".active")
        ?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (choices.length) void choose(active);
      else openCreate();
    }
  });
  async function choose(index: number) {
    const entry = choices[index];
    if (!entry || busy) return;
    brushes[mode] = entryKey(entry);
    updateTools();
    if (selected) await apply(entry, { ...selected });
    else {
      close();
      source.focus();
    }
  }
  async function apply(entry: Entry, evidence: Evidence, locate = false) {
    if (busy) return;
    busy = true;
    error();
    const identity = identify(),
      version = keModel.getVersionId(),
      previous = currentMark?.id;
    try {
      const request = {
        kind: entry.kind as Kind,
        name: entry.name,
        type: entry.type,
        params: entry.params.map((p) => p.type),
      };
      const result = await inspect({ annotation: request });
      if (
        identity !== identify() ||
        version !== keModel.getVersionId() ||
        model.getValue().slice(evidence.start, evidence.end) !== evidence.quote
      )
        return;
      if (result.edits.length) {
        ke.pushUndoStop();
        ke.executeEdits(
          "ke-annotation",
          result.edits.map((edit: any) => ({
            range: monaco.Range.fromPositions(
              keModel.getPositionAt(edit.start),
              keModel.getPositionAt(edit.end),
            ),
            text: edit.text,
          })),
        );
        ke.pushUndoStop();
      }
      annotations = annotations.filter(
        (mark) =>
          mark.id !== previous &&
          !(mark.start === evidence.start && mark.end === evidence.end),
      );
      annotations.push({
        ...request,
        ...evidence,
        id: previous || crypto.randomUUID(),
        declaration: result.declaration,
        ...(result.draft ? { draft: true } : {}),
      });
      renderMarks();
      close();
      host.changed();
      source.setPosition(model.getPositionAt(evidence.end));
      source.focus();
      if (locate && !result.draft) host.ke.jump(result.position);
      else if (!result.draft)
        ke.revealPositionInCenterIfOutsideViewport(
          keModel.getPositionAt(result.position),
        );
    } catch (cause) {
      if (picker.hidden) host.notify((cause as Error).message, true);
      else error((cause as Error).message);
    } finally {
      busy = false;
    }
  }
  $("annotation-change").addEventListener("click", () => {
    if (currentMark) openSearch({ ...currentMark }, currentMark);
  });
  $("annotation-remove").addEventListener("click", () => {
    annotations = annotations.filter((mark) => mark.id !== currentMark?.id);
    renderMarks();
    close();
    host.changed();
  });
  $("annotation-locate").addEventListener("click", () => {
    if (currentMark) {
      const entry = resolveMark(currentMark);
      if (entry) void apply(entry, { ...currentMark }, true);
    }
  });
  function openCreate() {
    form.reset();
    (form.elements.namedItem("name") as HTMLInputElement).value =
      search.value.trim();
    (form.elements.namedItem("label") as HTMLInputElement).value =
      selected?.quote.slice(0, 80) || "";
    form.querySelectorAll<HTMLElement>("[data-co-field]").forEach((field) => {
      field.hidden = field.dataset.coField !== mode;
    });
    $("annotation-title").textContent = `新建${titles[mode]}`;
    const state = host.workspace();
    const domain = state.question?.draft
      ? state.domains.find((d) => d.id === state.question?.coScope) ||
        state.domain
      : state.domain;
    $("annotation-create-scope").textContent =
      `保存到「${domain.name}」${mode === "operator" ? " · 签名可稍后在字典中补齐" : ""}`;
    show("create");
    (form.elements.namedItem("name") as HTMLInputElement).focus();
  }
  $("annotation-new").addEventListener("click", openCreate);
  $("annotation-create-back").addEventListener("click", () => {
    $("annotation-title").textContent = `选择${titles[mode]}`;
    show("search");
    search.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    const entry: Entry = {
      kind: mode,
      name: value("name"),
      type: mode === "operator" ? value("returns") : "Concept",
      params:
        mode === "operator" && value("params")
          ? value("params")
              .split(/[,，]/)
              .map((type, i) => ({ name: `arg${i + 1}`, type: type.trim() }))
          : [],
      ...(value("label") ? { label: value("label") } : {}),
      ...(mode === "concept" && value("parent")
        ? { parent: value("parent") }
        : {}),
    };
    const evidence = selected && { ...selected },
      identity = identify(),
      state = host.workspace();
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    busy = true;
    button.disabled = true;
    error();
    void api<Workspace>("/api/co", "POST", {
      domain: state.domain.id,
      entry,
      questionId: state.question?.id,
      draft: state.question?.draft,
    })
      .then(async (next) => {
        if (identity !== identify()) return;
        host.apply(next);
        const saved =
          next.libraries
            .flatMap((library) => library.entries)
            .find((co) => co.kind === entry.kind && co.name === entry.name) ||
          entry;
        brushes[mode] = entryKey(saved);
        updateTools();
        busy = false;
        if (evidence) await apply(saved, evidence);
        else {
          close();
          source.focus();
        }
      })
      .catch((cause) => error(cause.message))
      .finally(() => {
        busy = false;
        button.disabled = false;
      });
  });
  return {
    source,
    snapshot: () => ({ prompt: source.getValue(), annotations: readMarks() }),
    load(question?: Question) {
      close();
      drag.clear();
      loading = true;
      const text = question?.prompt || "";
      source.setValue(text);
      annotations = (question?.annotations || []).filter(
        (mark) =>
          ["concept", "operator"].includes(mark.kind) &&
          text.slice(mark.start, mark.end) === mark.quote,
      );
      renderMarks();
      editing = !text.trim();
      activeTool = false;
      updateTools();
      loading = false;
    },
  };
}
