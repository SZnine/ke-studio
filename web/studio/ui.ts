export const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
export const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};
export const field = (form: HTMLFormElement, name: string) =>
  form.elements.namedItem(name) as HTMLInputElement;
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
let toastTimer: ReturnType<typeof setTimeout>;
export function notify(text: string, error = false) {
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
export const run = (action: () => unknown | Promise<unknown>) =>
  Promise.resolve()
    .then(action)
    .catch((error) => notify(message(error), true));
export function button(
  text: string,
  action: () => unknown | Promise<unknown>,
  className = "text-button",
) {
  const element = node("button", text, className);
  element.type = "button";
  element.addEventListener("click", () => void run(action));
  return element;
}
export function download(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = node("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function formError(selector: string, error?: unknown) {
  const element = $(selector);
  element.hidden = !error;
  element.textContent = error ? message(error) : "";
}
export function modal(selector: string) {
  $(selector)
    .querySelectorAll<HTMLElement>(".form-error")
    .forEach((e) => {
      e.hidden = true;
    });
  $(selector).querySelector("form")?.reset();
  $<HTMLDialogElement>(selector).showModal();
}
