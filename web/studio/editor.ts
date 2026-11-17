import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/features/codeEditor/register.js";
import "monaco-editor/features/tokenization/register.js";
import "monaco-editor/features/clipboard/register.js";
import "monaco-editor/features/contextmenu/register.js";
// The feature entry registers inline suggestions only; the popup owns its controller.
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/features/snippet/register.js";
import "monaco-editor/features/hover/register.js";
import "monaco-editor/features/parameterHints/register.js";
import "monaco-editor/features/semanticTokens/register.js";
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js";
import "monaco-editor/features/format/register.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/features/gotoError/register.js";
import "monaco-editor/features/codeAction/register.js";
import "monaco-editor/features/bracketMatching/register.js";
import "monaco-editor/features/wordOperations/register.js";
import "monaco-editor/features/linesOperations/register.js";
import "monaco-editor/features/codicon/register.js";
import type { Workspace } from "../../src/studio/language";
import { api } from "./api";
import { CompletionSession } from "./completion-session";
import { assetUrl } from "../../src/studio/assets";

(globalThis as any).MonacoEnvironment = {
  getWorker: () =>
    new Worker(assetUrl("editor.worker.js"), {
      type: "module",
    }),
};
monaco.languages.register({ id: "ke", extensions: [".ke"] });
function applyTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue("--" + name).trim();
  const background = color("background"),
    foreground = color("foreground"),
    accent = color("accent"),
    muted = color("muted-foreground"),
    border = color("border"),
    surface = color("surface");
  monaco.editor.defineTheme("ke-site", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: accent.slice(1) },
      { token: "type", foreground: dark ? "79C0FF" : "006CAC" },
      { token: "function", foreground: dark ? "D2A8FF" : "6639BA" },
      { token: "comment", foreground: muted.slice(1) },
      { token: "number", foreground: dark ? "A5D6FF" : "0550AE" },
      { token: "string", foreground: dark ? "A5D6FF" : "0A3069" },
      { token: "operator", foreground: foreground.slice(1) },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorLineNumber.foreground": muted,
      "editorLineNumber.activeForeground": accent,
      "editor.lineHighlightBackground": surface,
      "editor.selectionBackground": color("muted"),
      "editorCursor.foreground": accent,
      "editorWidget.background": background,
      "editorWidget.border": border,
      "editorHoverWidget.background": background,
      "editorHoverWidget.border": border,
      "editorSuggestWidget.background": background,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.foreground": foreground,
      "editorSuggestWidget.selectedBackground": color("muted"),
      "editorSuggestWidget.selectedForeground": foreground,
      "editorSuggestWidget.highlightForeground": accent,
      "editorSuggestWidget.focusHighlightForeground": accent,
      focusBorder: accent,
      "widget.border": border,
      "input.background": surface,
      "input.foreground": foreground,
      "input.border": border,
      "list.hoverBackground": surface,
      "menu.background": background,
      "menu.foreground": foreground,
      "menu.selectionBackground": color("muted"),
      "menu.selectionForeground": foreground,
      "menu.border": border,
      "menu.separatorBackground": border,
      "scrollbarSlider.background": muted + "55",
      "scrollbarSlider.hoverBackground": muted + "88",
    },
  });
  monaco.editor.setTheme("ke-site");
}
applyTheme();
window.addEventListener("ke-theme", applyTheme);

// Monaco consumes the local worker; completion policy lives in editable language files.
export function createEditor(element: HTMLElement, save: () => void) {
  const editor = monaco.editor.create(element, {
    language: "ke",
    theme: "ke-site",
    automaticLayout: true,
    fontSize: 15,
    lineHeight: 26,
    fontFamily: "Google Sans Code, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    padding: { top: 20, bottom: 20 },
    tabSize: 2,
    wordWrap: "on",
    wordBasedSuggestions: "off",
    quickSuggestions: { other: true, comments: false, strings: false },
    quickSuggestionsDelay: 0,
    formatOnType: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "off",
    tabCompletion: "off",
    acceptSuggestionOnCommitCharacter: false,
    suggest: {
      showWords: false,
      localityBonus: false,
      snippetsPreventQuickSuggestions: false,
    },
    suggestSelection: "first",
    "semanticHighlighting.enabled": true,
  });
  const model = editor.getModel()!;
  const completionSession = new CompletionSession();
  const dismissCompletions = () => {
    completionSession.dismiss();
    manualCompletion = false;
    editor.trigger("ke", "hideSuggestWidget", {});
  };
  editor.onKeyDown((event) => {
    if ([monaco.KeyCode.Escape, monaco.KeyCode.Enter].includes(event.keyCode))
      dismissCompletions();
    else if (
      !event.ctrlKey &&
      !event.metaKey &&
      event.browserEvent.key.length === 1 &&
      event.browserEvent.key.trim()
    )
      completionSession.typed(event.browserEvent.key);
  });
  editor.onDidCompositionStart(() => completionSession.resume());
  editor.addAction({
    id: "ke.finishCompletion",
    label: "完成声明",
    run: dismissCompletions,
  });
  editor.addAction({
    id: "ke.completeNext",
    label: "继续补全",
    run() {
      if (completionSession.dismissed) return;
      editor.trigger("ke", "editor.action.triggerParameterHints", {});
      editor.trigger("ke", "editor.action.triggerSuggest", {});
    },
  });
  let manualCompletion = false;
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
    completionSession.resume();
    manualCompletion = true;
    editor.trigger("keyboard", "editor.action.triggerSuggest", {});
  });
  editor.onDidChangeModelContent(() => {
    manualCompletion = false;
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
  let state: Workspace,
    options: any = { callStyle: "smart" };
  let providers: monaco.IDisposable[] = [],
    configuration: monaco.IDisposable | undefined;
  const changed = new monaco.Emitter<void>();
  const cache = new Map<string, Promise<any>>();
  const range = (start: number, end: number) =>
    monaco.Range.fromPositions(
      model.getPositionAt(start),
      model.getPositionAt(end),
    );
  const post = (route: string, body: unknown) =>
    api<any>("/api/" + route, "POST", body);
  const inspect = (
    offset = 0,
    manual = false,
    completion = false,
    onEnter = false,
  ) => {
    if (!state)
      return Promise.resolve({ issues: [], completions: [], highlights: [] });
    const key = [
      state.domain.id,
      state.editorContext,
      model.getVersionId(),
      offset,
      JSON.stringify({ ...options, manual, enabled: completion, onEnter }),
    ].join(":");
    if (!cache.has(key)) {
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      cache.set(
        key,
        post("analyze", {
          domain: state.domain.id,
          questionId: state.question?.id,
          draft: state.question?.draft,
          editorContext: state.editorContext,
          text: model.getValue(),
          offset,
          completion: {
            ...options,
            manual,
            onEnter,
            enabled: completion && options.enabled !== false,
          },
        }).catch((error) => {
          cache.delete(key);
          throw error;
        }),
      );
    }
    return cache.get(key)!;
  };
  const formatted = () =>
    post("format", {
      domain: state.domain.id,
      questionId: state.question?.id,
      draft: state.question?.draft,
      editorContext: state.editorContext,
      text: model.getValue(),
    });
  function register() {
    providers.forEach((p) => p.dispose());
    const triggerCharacters = state.language.editor.triggers.filter(
      (t) => t.length === 1,
    );
    providers = [
      monaco.languages.registerCompletionItemProvider("ke", {
        triggerCharacters,
        async provideCompletionItems(_, position, _context, token) {
          if (completionSession.dismissed) return { suggestions: [] };
          const request = completionSession.revision;
          const version = model.getVersionId(),
            context = state.editorContext;
          const result = await inspect(
            model.getOffsetAt(position),
            manualCompletion,
            true,
          );
          if (
            token.isCancellationRequested ||
            version !== model.getVersionId() ||
            context !== state.editorContext ||
            !completionSession.accepts(request)
          )
            return;
          const kinds: any = {
            type: monaco.languages.CompletionItemKind.Class,
            value: monaco.languages.CompletionItemKind.Variable,
            operator: monaco.languages.CompletionItemKind.Function,
            keyword: monaco.languages.CompletionItemKind.Keyword,
          };
          return {
            incomplete: true,
            suggestions: result.completions.map((s: any) => ({
              label: { label: s.name, description: s.label },
              detail: s.detail,
              kind: kinds[s.kind],
              documentation: s.documentation,
              insertText: s.insert,
              sortText: s.sort + s.name,
              filterText: s.filter,
              insertTextRules: s.snippet
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range: range(s.replace.start, s.replace.end),
              additionalTextEdits: s.edits?.map((edit: any) => ({
                range: range(edit.start, edit.end),
                text: edit.text,
              })),
              command: s.finished
                ? { id: "ke.finishCompletion", title: "完成声明" }
                : s.suggest
                  ? { id: "ke.completeNext", title: "继续补全" }
                  : s.kind === "operator" && s.snippet
                    ? {
                        id: "editor.action.triggerParameterHints",
                        title: "参数提示",
                      }
                    : s.kind === "keyword" && s.snippet
                      ? {
                          id: "editor.action.triggerSuggest",
                          title: "类型补全",
                        }
                      : undefined,
            })),
          };
        },
      }),
      monaco.languages.registerOnTypeFormattingEditProvider("ke", {
        autoFormatTriggerCharacters: ["\n"],
        async provideOnTypeFormattingEdits(_, position, _ch, _options, token) {
          if (options.callStyle !== "smart" || options.enabled === false)
            return [];
          const version = model.getVersionId(),
            context = state.editorContext;
          const result = await inspect(
            model.getOffsetAt(position),
            false,
            false,
            true,
          );
          if (
            token.isCancellationRequested ||
            version !== model.getVersionId() ||
            context !== state.editorContext
          )
            return [];
          return (result.continuationEdits || []).map((edit: any) => ({
            range: range(edit.start, edit.end),
            text: edit.text,
          }));
        },
      }),
      monaco.languages.registerSignatureHelpProvider("ke", {
        signatureHelpTriggerCharacters: triggerCharacters.filter((t) =>
          t.trim(),
        ),
        signatureHelpRetriggerCharacters: state.language.editor.brackets.map(
          (pair) => pair[1],
        ),
        async provideSignatureHelp(_, position, token) {
          const result = await inspect(model.getOffsetAt(position));
          if (token.isCancellationRequested || !result.signature) return;
          return { value: result.signature, dispose() {} };
        },
      }),
      monaco.languages.registerHoverProvider("ke", {
        async provideHover(_, position, token) {
          const result = await inspect(model.getOffsetAt(position));
          if (token.isCancellationRequested || !result.hover) return;
          const h = result.hover;
          return {
            range: range(h.start, h.end),
            contents: [
              { value: "```ke\n" + h.label + "\n```" },
              { value: h.description, isTrusted: false },
            ],
          };
        },
      }),
      monaco.languages.registerDocumentFormattingEditProvider("ke", {
        async provideDocumentFormattingEdits() {
          const version = model.getVersionId(),
            result = await formatted();
          return version === model.getVersionId()
            ? [{ range: model.getFullModelRange(), text: result.text }]
            : [];
        },
      }),
      monaco.languages.registerCodeActionProvider("ke", {
        async provideCodeActions(_, selection) {
          const version = model.getVersionId(),
            result = await inspect();
          const start = model.getOffsetAt(selection.getStartPosition()),
            end = model.getOffsetAt(selection.getEndPosition());
          return {
            actions: result.issues
              .filter(
                (i: any) =>
                  i.replacement !== undefined &&
                  i.start <= end &&
                  i.end >= start,
              )
              .map((i: any) => ({
                title: `改为 ${i.replacement}`,
                kind: "quickfix",
                edit: {
                  edits: [
                    {
                      resource: model.uri,
                      versionId: version,
                      textEdit: {
                        range: range(i.start, i.end),
                        text: i.replacement,
                      },
                    },
                  ],
                },
              })),
            dispose() {},
          };
        },
      }),
      monaco.languages.registerDocumentSemanticTokensProvider("ke", {
        onDidChange: changed.event,
        getLegend: () => ({
          tokenTypes: state.language.tokenTypes,
          tokenModifiers: [],
        }),
        async provideDocumentSemanticTokens(_, _last, token) {
          const version = model.getVersionId(),
            result = await inspect();
          if (token.isCancellationRequested || version !== model.getVersionId())
            return null;
          const data: number[] = [];
          let previousLine = 0,
            previousColumn = 0;
          for (const t of result.highlights) {
            const from = model.getPositionAt(t.start),
              to = model.getPositionAt(t.end);
            for (let line = from.lineNumber; line <= to.lineNumber; line++) {
              const column = line === from.lineNumber ? from.column - 1 : 0;
              const end =
                line === to.lineNumber
                  ? to.column - 1
                  : model.getLineLength(line);
              if (end <= column) continue;
              const row = line - 1;
              data.push(
                row - previousLine,
                row === previousLine ? column - previousColumn : column,
                end - column,
                state.language.tokenTypes.indexOf(t.type),
                0,
              );
              previousLine = row;
              previousColumn = column;
            }
          }
          return { data: new Uint32Array(data) };
        },
        releaseDocumentSemanticTokens() {},
      }),
    ];
  }
  return {
    editor,
    getText: () => model.getValue(),
    applyEdit(start: number, end: number, text: string) {
      editor.pushUndoStop();
      editor.executeEdits("ke-fix", [{ range: range(start, end), text }]);
      editor.pushUndoStop();
    },
    setText(text: string) {
      editor.executeEdits("ke-studio", [
        { range: model.getFullModelRange(), text },
      ]);
      editor.pushUndoStop();
    },
    setOptions(value: any) {
      options = value;
      cache.clear();
    },
    setWorkspace(value: Workspace, loadDocument = false) {
      const newLanguage =
        !state || state.language.revision !== value.language.revision;
      const newContext =
        !state ||
        state.editorContext !== value.editorContext ||
        state.domain.id !== value.domain.id ||
        state.storage.bank !== value.storage.bank;
      state = value;
      if (newContext || loadDocument) cache.clear();
      if (newLanguage) {
        configuration?.dispose();
        configuration = monaco.languages.setLanguageConfiguration("ke", {
          wordPattern: /[\p{L}_][\p{L}\p{N}_]*/gu,
          brackets: value.language.editor.brackets as [string, string][],
          autoClosingPairs: value.language.editor.brackets.map(
            ([open, close]) => ({ open, close }),
          ),
        });
        register();
      }
      if (loadDocument) {
        completionSession.resume();
        model.setValue(value.question?.ke || "");
      }
      if (newContext || newLanguage) changed.fire();
    },
    async diagnostics() {
      const version = model.getVersionId();
      let issues: any[];
      try {
        issues = (await inspect()).issues;
      } catch (error) {
        issues = [
          {
            start: 0,
            end: 0,
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
            code: "service",
          },
        ];
      }
      if (version !== model.getVersionId()) return undefined;
      monaco.editor.setModelMarkers(
        model,
        "ke",
        issues.map((issue) => ({
          ...range(issue.start, issue.end),
          message: issue.message,
          code: issue.code,
          severity:
            issue.severity === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Error,
        })),
      );
      return issues;
    },
    jump(offset: number) {
      const position = model.getPositionAt(offset);
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    },
    async format() {
      const version = model.getVersionId(),
        result = await formatted();
      if (version === model.getVersionId()) this.setText(result.text);
    },
    dispose() {
      configuration?.dispose();
      providers.forEach((d) => d.dispose());
      changed.dispose();
      editor.dispose();
    },
  };
}
