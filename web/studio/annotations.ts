import * as monaco from "monaco-editor/editor/editor.api.js";
import { api } from "./api";
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
  notify(message: string, error?: boolean): void;
}
const letters = { concept: "C", operator: "O", var: "V" };
const dragType = "application/x-ke-declaration";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.querySelector<T>("#" + id)!;

/** Text stays plain and editable. Monaco tracks evidence ranges without another document format. */
export function createAnnotations(host: Host) {
  const source = monaco.editor.create($("question-prompt"), {
    language: "plaintext",
    theme: "ke-site",
    automaticLayout: true,
    fontFamily: "Google Sans Code, monospace",
    fontSize: 14,
    lineHeight: 27,
    wordWrap: "on",
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "none",
    padding: { top: 14, bottom: 14 },
    quickSuggestions: false,
    wordBasedSuggestions: "off",
    dragAndDrop: false,
    overviewRulerLanes: 0,
    scrollbar: { verticalScrollbarSize: 8 },
    ariaLabel: "题目原文，可划选后关联概念、算子或实例",
  });
  const model = source.getModel()!,
    ke = host.ke.editor,
    keModel = ke.getModel()!;
  source.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, host.save);
  const marks = source.createDecorationsCollection(),
    selectionMark = source.createDecorationsCollection();
  const dropMark = ke.createDecorationsCollection();
  let annotations: TextAnnotation[] = [],
    mode: TextAnnotation["kind"] | undefined;
  let loading = false,
    busy = false,
    selected: { start: number; end: number; quote: string } | undefined;
  let active = 0,
    choices: Entry[] = [],
    drag: { start: number; end: number } | TextAnnotation | undefined;
  let dragSequence = 0;
  const range = (start: number, end: number) =>
    monaco.Range.fromPositions(
      model.getPositionAt(start),
      model.getPositionAt(end),
    );
  const codeRange = (start: number, end: number) =>
    monaco.Range.fromPositions(
      keModel.getPositionAt(start),
      keModel.getPositionAt(end),
    );
  const picker = $("annotation-picker"),
    search = $<HTMLInputElement>("annotation-search");
  const error = (message = "") => {
    $("annotation-error").textContent = message;
    $("annotation-error").hidden = !message;
  };
  const identify = () => {
    const s = host.workspace();
    return s && `${s.storage.bank}:${s.domain.id}:${s.question?.id}`;
  };
  function close() {
    picker.hidden = true;
    selectionMark.clear();
    selected = undefined;
    error();
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
            { value: `${letters[mark.kind]} · **${mark.name}**` },
            { value: "```ke\n" + mark.declaration + "\n```" },
          ],
        },
      })),
    );
    const links = $("annotation-links");
    links.replaceChildren();
    for (const mark of annotations) {
      const chip = document.createElement("span");
      chip.className = "annotation-link annotation-" + mark.kind;
      chip.draggable = true;
      chip.title =
        mark.quote + "\n" + mark.declaration + "\n拖入 KE 区可定位或补齐声明";
      const label = document.createElement("button");
      label.textContent = letters[mark.kind] + " " + mark.name;
      label.addEventListener("click", () => {
        source.setSelection(range(mark.start, mark.end));
        source.revealRangeInCenter(range(mark.start, mark.end));
        source.focus();
      });
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "解除原文关联，保留代码";
      remove.setAttribute("aria-label", "解除 " + mark.name + " 的原文关联");
      remove.addEventListener("click", () => {
        annotations = annotations.filter((a) => a.id !== mark.id);
        renderMarks();
        host.changed();
      });
      chip.append(label, remove);
      chip.addEventListener("dragstart", (event) => {
        drag = mark;
        event.dataTransfer!.setData(dragType, mark.id);
        event.dataTransfer!.effectAllowed = "copy";
      });
      chip.addEventListener("dragend", clearDrag);
      links.append(chip);
    }
  }
  function readMarks() {
    return annotations.flatMap((mark, index) => {
      const current = marks.getRange(index);
      if (!current || model.getValueInRange(current) !== mark.quote) return [];
      return [
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
  function open() {
    const current = source.getSelection();
    if (
      !mode ||
      !current ||
      current.isEmpty() ||
      !model.getValueInRange(current).trim()
    )
      return;
    selected = {
      start: model.getOffsetAt(current.getStartPosition()),
      end: model.getOffsetAt(current.getEndPosition()),
      quote: model.getValueInRange(current),
    };
    selectionMark.set([
      { range: current, options: { inlineClassName: "evidence-selection" } },
    ]);
    $("annotation-quote").textContent = letters[mode] + " · " + selected.quote;
    $("annotation-values").hidden = mode !== "var";
    $<HTMLInputElement>("annotation-name").value =
      selected.quote.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] || "";
    $<HTMLInputElement>("annotation-value").value = "";
    search.placeholder =
      mode === "var" ? "选择实例类型，支持拼音缩写" : "名称、中文或拼音缩写";
    search.value =
      mode === "var"
        ? annotations.find(
            (mark) =>
              mark.kind === "concept" &&
              mark.start === selected!.start &&
              mark.end === selected!.end,
          )?.name || ""
        : "";
    picker.hidden = false;
    error();
    renderChoices();
    search.focus();
  }
  function setMode(value: TextAnnotation["kind"]) {
    mode = mode === value && picker.hidden ? undefined : value;
    document
      .querySelectorAll<HTMLButtonElement>("[data-annotation]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.annotation === mode),
        ),
      );
    $("annotation-hint").textContent = mode
      ? `${letters[mode]} · 划选原文后搜索，Esc 取消`
      : "选择 C / O / V，再划选原文";
    close();
    open();
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-annotation]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setMode(button.dataset.annotation as TextAnnotation["kind"]),
      ),
    );
  for (const [kind, key] of [
    ["concept", monaco.KeyCode.KeyC],
    ["operator", monaco.KeyCode.KeyO],
    ["var", monaco.KeyCode.KeyV],
  ] as const)
    source.addCommand(monaco.KeyMod.Alt | key, () => setMode(kind));
  source.onMouseUp(() => {
    if (picker.hidden) open();
  });
  source.addCommand(monaco.KeyCode.Escape, () => {
    close();
    mode = undefined;
    document
      .querySelectorAll("[data-annotation]")
      .forEach((b) => b.setAttribute("aria-pressed", "false"));
  });
  $("annotation-close").addEventListener("click", close);
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      source.focus();
    }
    if (
      event.key === "Enter" &&
      (event.target as HTMLElement).closest("#annotation-values")
    ) {
      event.preventDefault();
      void choose(active);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      !picker.hidden &&
      !(event.target as HTMLElement).closest(".source-pane")
    )
      close();
  });
  function renderChoices() {
    const state = host.workspace();
    if (!state) return;
    const all = new Map<string, Entry>();
    for (const entry of [
      ...state.coreEntries,
      ...state.libraries.flatMap((library) => library.entries),
    ])
      all.set(entryKey(entry), entry);
    const query = search.value.trim();
    choices = [...all.values()]
      .filter(
        (entry) =>
          entry.kind === (mode === "operator" ? "operator" : "concept"),
      )
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
      .slice(0, 12)
      .map((item) => item.entry);
    active = 0;
    const list = $("annotation-results");
    list.replaceChildren();
    for (const [index, entry] of choices.entries()) {
      const button = document.createElement("button");
      button.className = "annotation-result";
      button.setAttribute("role", "option");
      const name = document.createElement("strong"),
        detail = document.createElement("small");
      name.textContent = entry.name + (entry.label ? " · " + entry.label : "");
      const type = (value: string) =>
        displayType(value, state.language.editor.typeSyntax);
      detail.textContent =
        entry.kind === "operator"
          ? `(${entry.params.map((p) => type(p.type)).join(", ")}) → ${type(entry.type)}`
          : entry.parent
            ? "父级 " + entry.parent
            : "概念";
      button.append(name, detail);
      button.addEventListener("click", () => void choose(index));
      list.append(button);
    }
    if (!choices.length) list.textContent = "当前 CO 中没有匹配项";
    highlightChoice();
  }
  function highlightChoice() {
    $("annotation-results")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button, i) => {
        button.classList.toggle("active", i === active);
        button.setAttribute("aria-selected", String(i === active));
      });
  }
  search.addEventListener("input", renderChoices);
  search.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      active = Math.max(
        0,
        Math.min(
          choices.length - 1,
          active + (event.key === "ArrowDown" ? 1 : -1),
        ),
      );
      highlightChoice();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void choose(active);
    }
  });
  const inspect = (extra: object) => {
    const state = host.workspace();
    return api<any>("/api/analyze", "POST", {
      domain: state.domain.id,
      questionId: state.question?.id,
      draft: state.question?.draft,
      editorContext: state.editorContext,
      text: host.ke.getText(),
      completion: { enabled: false },
      ...extra,
    });
  };
  function applyEdits(edits: { start: number; end: number; text: string }[]) {
    if (!edits.length) return;
    ke.pushUndoStop();
    ke.executeEdits(
      "ke-annotation",
      edits.map((edit) => ({
        range: codeRange(edit.start, edit.end),
        text: edit.text,
      })),
    );
    ke.pushUndoStop();
  }
  async function choose(index: number) {
    const entry = choices[index];
    if (busy || !entry || !mode || !selected) return;
    busy = true;
    error();
    const evidence = { ...selected },
      kind = mode,
      identity = identify(),
      version = keModel.getVersionId();
    const request =
      kind === "var"
        ? {
            kind,
            name: $<HTMLInputElement>("annotation-name").value.trim(),
            type: entry.name,
            value: $<HTMLInputElement>("annotation-value").value.trim(),
          }
        : {
            kind,
            name: entry.name,
            type: entry.type,
            params: entry.params.map((p) => p.type),
          };
    try {
      const result = await inspect({ annotation: request });
      if (
        identity !== identify() ||
        version !== keModel.getVersionId() ||
        model.getValue().slice(evidence.start, evidence.end) !== evidence.quote
      ) {
        error("内容已变化，请重新选择。");
        return;
      }
      applyEdits(result.edits);
      const mark = {
        ...request,
        ...evidence,
        id: crypto.randomUUID(),
        declaration: result.declaration,
      };
      annotations = annotations.filter(
        (a) =>
          !(
            a.start === mark.start &&
            a.end === mark.end &&
            a.kind === mark.kind
          ),
      );
      annotations.push(mark);
      renderMarks();
      close();
      host.changed();
      $("annotation-hint").textContent = result.added.length
        ? "已补充 " + result.added.join("、")
        : "已关联现有声明";
      ke.revealPositionInCenterIfOutsideViewport(
        keModel.getPositionAt(result.position),
      );
      source.setPosition(model.getPositionAt(evidence.end));
      source.focus();
    } catch (e) {
      error(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
  // A small drag handle avoids fighting Monaco's ordinary text-selection drag behavior.
  const handle = $("move-declaration");
  ke.onDidChangeCursorSelection(({ selection }) => {
    handle.hidden = selection.isEmpty();
  });
  handle.addEventListener("dragstart", (event) => {
    const selected = ke.getSelection();
    if (!selected || selected.isEmpty()) {
      event.preventDefault();
      return;
    }
    drag = {
      start: keModel.getOffsetAt(selected.getStartPosition()),
      end: keModel.getOffsetAt(selected.getEndPosition()),
    };
    event.dataTransfer!.setData(dragType, "selection");
    event.dataTransfer!.effectAllowed = "move";
  });
  function clearDrag() {
    drag = undefined;
    dragSequence++;
    dropMark.clear();
  }
  handle.addEventListener("dragend", clearDrag);
  const target = $("editor");
  async function dropPlan(event: DragEvent) {
    const offset = keModel.getOffsetAt(
      ke.getTargetAtClientPoint(event.clientX, event.clientY)?.position ||
        ke.getPosition()!,
    );
    return inspect(
      drag && "kind" in drag ? { annotation: drag } : { move: drag, offset },
    );
  }
  target.addEventListener("dragover", (event) => {
    if (!drag || !event.dataTransfer?.types.includes(dragType)) return;
    event.preventDefault();
    event.stopPropagation();
    const seq = ++dragSequence,
      version = keModel.getVersionId();
    void dropPlan(event)
      .then((plan) => {
        if (!drag || seq !== dragSequence || version !== keModel.getVersionId())
          return;
        const at = keModel.getPositionAt(plan.position);
        dropMark.set([
          {
            range: new monaco.Range(at.lineNumber, 1, at.lineNumber, 1),
            options: { isWholeLine: true, className: "declaration-drop-line" },
          },
        ]);
      })
      .catch(() => dropMark.clear());
  });
  target.addEventListener("dragleave", (event) => {
    if (!target.contains(event.relatedTarget as Node)) dropMark.clear();
  });
  target.addEventListener("drop", (event) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const version = keModel.getVersionId(),
      identity = identify();
    void dropPlan(event)
      .then((plan) => {
        if (version !== keModel.getVersionId() || identity !== identify())
          return;
        applyEdits(plan.edits);
        const adjustment = plan.edits
          .filter((edit: any) => edit.start < plan.position)
          .reduce(
            (sum: number, edit: any) =>
              sum + edit.text.length - (edit.end - edit.start),
            0,
          );
        host.ke.jump(plan.position + adjustment);
      })
      .catch((e) => host.notify(e.message, true))
      .finally(clearDrag);
  });
  return {
    source,
    snapshot: () => ({ prompt: model.getValue(), annotations: readMarks() }),
    load(question?: Question) {
      loading = true;
      close();
      clearDrag();
      try {
        model.setValue(question?.prompt || "");
        annotations = (question?.annotations || []).filter(
          (a) => model.getValue().slice(a.start, a.end) === a.quote,
        );
        renderMarks();
      } finally {
        loading = false;
      }
    },
  };
}
