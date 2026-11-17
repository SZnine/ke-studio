import type { Workspace } from "../../src/studio/language";
import { connect } from "./api";
import { preference, savePreference } from "../../src/studio/preferences";

export async function initStorage(host: {
  save(): Promise<void>;
  apply(state: Workspace): void;
}) {
  const dialog = document.querySelector<HTMLDialogElement>("#storage-dialog")!;
  const error = dialog.querySelector<HTMLElement>(".form-error")!;
  const choose = document.querySelector<HTMLButtonElement>("#choose-folder")!;
  const resume = document.querySelector<HTMLButtonElement>("#resume-folder")!;
  const close = document.querySelector<HTMLButtonElement>("#close-storage")!;
  const status = document.querySelector<HTMLElement>("#storage-status")!;
  let handle = await preference<FileSystemDirectoryHandle>("folder");
  let opened = false,
    busy = false;
  function loading(value: boolean) {
    busy = value;
    choose.disabled = value;
    resume.disabled = value;
    status.textContent = value ? "正在打开本地文件并编译语法…" : "";
  }
  async function open(selected: FileSystemDirectoryHandle) {
    loading(true);
    error.hidden = true;
    try {
      await host.save();
      const workspace = await connect(selected);
      await savePreference("folder", selected);
      handle = selected;
      opened = true;
      host.apply(workspace);
      dialog.close();
    } catch (cause) {
      error.textContent =
        cause instanceof Error ? cause.message : String(cause);
      error.hidden = false;
    } finally {
      loading(false);
    }
  }
  function show() {
    close.hidden = !opened;
    resume.hidden = !handle;
    resume.textContent = handle ? "继续使用 " + handle.name : "";
    dialog.showModal();
  }
  dialog.addEventListener("cancel", (event) => {
    if (!opened || busy) event.preventDefault();
  });
  close.onclick = () => dialog.close();
  document.querySelector("#storage-settings")!.addEventListener("click", show);
  choose.onclick = async () => {
    try {
      await open(
        await window.showDirectoryPicker({
          id: "ke-workspace",
          mode: "readwrite",
        }),
      );
    } catch (cause) {
      if ((cause as DOMException).name !== "AbortError") {
        error.textContent = String(cause);
        error.hidden = false;
      }
    }
  };
  resume.onclick = async () => {
    if (
      handle &&
      (await handle.requestPermission({ mode: "readwrite" })) === "granted"
    )
      await open(handle);
  };
  show();
  if (!("showDirectoryPicker" in window)) {
    choose.disabled = true;
    resume.hidden = true;
    error.textContent =
      "请使用桌面版 Edge 或 Chrome 打开，才能选择并保存本地文件夹。";
    error.hidden = false;
  } else if (
    handle &&
    (await handle.queryPermission({ mode: "readwrite" })) === "granted"
  )
    await open(handle);
}
