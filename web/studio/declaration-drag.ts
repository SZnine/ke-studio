import * as monaco from "monaco-editor/editor/editor.api.js";
import type { TextAnnotation } from "../../src/studio/language";
import type { createEditor } from "./editor";

export function declarationDrag(
  ke: ReturnType<typeof createEditor>,
  inspect: (request: object) => Promise<any>,
  identity: () => string,
  notify: (text: string, error?: boolean) => void,
) {
  const editor = ke.editor,
    model = editor.getModel()!,
    target = document.querySelector<HTMLElement>("#editor")!;
  const marker = editor.createDecorationsCollection(),
    mime = "application/x-ke-declaration";
  let drag: { start: number; end: number } | TextAnnotation | undefined,
    sequence = 0;
  const range = (start: number, end: number) =>
    monaco.Range.fromPositions(
      model.getPositionAt(start),
      model.getPositionAt(end),
    );
  function clear() {
    drag = undefined;
    sequence++;
    marker.clear();
  }
  function start(event: DragEvent, value: typeof drag) {
    if (!value) return;
    drag = value;
    event.dataTransfer!.setData(mime, "declaration");
    event.dataTransfer!.effectAllowed = "kind" in value ? "copy" : "move";
  }
  const handle = document.querySelector<HTMLElement>("#move-declaration")!;
  editor.onDidChangeCursorSelection(({ selection }) => {
    handle.hidden = selection.isEmpty();
  });
  handle.addEventListener("dragstart", (event) => {
    const selected = editor.getSelection();
    if (!selected || selected.isEmpty()) {
      event.preventDefault();
      return;
    }
    start(event, {
      start: model.getOffsetAt(selected.getStartPosition()),
      end: model.getOffsetAt(selected.getEndPosition()),
    });
  });
  handle.addEventListener("dragend", clear);
  const plan = (event: DragEvent) =>
    inspect(
      drag && "kind" in drag
        ? { annotation: drag }
        : {
            move: drag,
            offset: model.getOffsetAt(
              editor.getTargetAtClientPoint(event.clientX, event.clientY)
                ?.position || editor.getPosition()!,
            ),
          },
    );
  target.addEventListener("dragover", (event) => {
    if (!drag || !event.dataTransfer?.types.includes(mime)) return;
    event.preventDefault();
    event.stopPropagation();
    const ticket = ++sequence,
      version = model.getVersionId();
    void plan(event)
      .then((result) => {
        if (!drag || ticket !== sequence || version !== model.getVersionId())
          return;
        const line = model.getPositionAt(result.position).lineNumber;
        marker.set([
          {
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: "declaration-drop-line" },
          },
        ]);
      })
      .catch(() => marker.clear());
  });
  target.addEventListener("dragleave", (event) => {
    if (!target.contains(event.relatedTarget as Node)) marker.clear();
  });
  target.addEventListener("drop", (event) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const version = model.getVersionId(),
      question = identity();
    void plan(event)
      .then((result) => {
        if (version !== model.getVersionId() || question !== identity()) return;
        if (result.edits.length) {
          editor.pushUndoStop();
          editor.executeEdits(
            "ke-declaration-drag",
            result.edits.map((edit: any) => ({
              range: range(edit.start, edit.end),
              text: edit.text,
            })),
          );
          editor.pushUndoStop();
        }
        const shift = result.edits
          .filter((edit: any) => edit.start < result.position)
          .reduce(
            (sum: number, edit: any) =>
              sum + edit.text.length - edit.end + edit.start,
            0,
          );
        ke.jump(result.position + shift);
      })
      .catch((error) => notify(error.message, true))
      .finally(clear);
  });
  return { start, clear };
}
