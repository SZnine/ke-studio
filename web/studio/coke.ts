import type { CokeCase, Workspace } from "../../src/studio/language";
import type { CokeResult } from "../../src/studio/coke";
import { api } from "./api";

interface Host {
  workspace(): Workspace;
  text(): string;
  notify(message: string, error?: boolean): void;
}
export function createCoke(host: Host) {
  const panel = document.querySelector<HTMLElement>("#panel-coke")!;
  const dialog = document.querySelector<HTMLDialogElement>("#coke-dialog")!;
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const list = panel.querySelector<HTMLElement>("#coke-list")!;
  const error = dialog.querySelector<HTMLElement>(".form-error")!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  let selected = "",
    editing = "",
    cases: CokeCase[] = [],
    checks: CokeResult[] = [];
  const run = (fn: () => Promise<void>) =>
    void fn().catch((e) => host.notify(e.message, true));
  const node = (tag: string, text = "") => {
    const item = document.createElement(tag);
    item.textContent = text;
    return item;
  };
  function render() {
    list.replaceChildren();
    panel.querySelector("#coke-count")!.textContent =
      `${cases.filter((c) => c.confirmed).length} 个已确认 · ${cases.length} 个标准例`;
    if (!cases.length)
      list.append(
        node(
          "p",
          "添加原文、CO 和 KE，人工确认后用于每次语言与库更新的回归检查。",
        ),
      );
    for (const item of cases) {
      const row = node("article");
      row.className = "coke-card";
      const heading = node("button", item.title) as HTMLButtonElement;
      heading.className = "text-button";
      heading.addEventListener("click", () => edit(item));
      const result = checks.find((r) => r.id === item.id);
      row.append(
        heading,
        node(
          "small",
          `${item.confirmed ? "人工已确认" : "待确认"} · ${result?.issues.length ? "检查未通过" : "检查通过"}`,
        ),
      );
      row.append(node("p", item.naturalLanguage));
      if (result?.issues.length) {
        const details = document.createElement("details");
        details.append(
          node("summary", `${result.issues.length} 个检查问题`),
          node(
            "pre",
            result.issues.map((i) => `${i.line}: ${i.message}`).join("\n"),
          ),
        );
        row.append(details);
      }
      list.append(row);
    }
  }
  async function load() {
    const domain = host.workspace().domain.id;
    const result = await api<{ cases: CokeCase[]; checks: CokeResult[] }>(
      "/api/coke?domain=" + encodeURIComponent(domain),
    );
    if (domain !== host.workspace().domain.id) return;
    selected = domain;
    cases = result.cases;
    checks = result.checks;
    render();
  }
  function edit(item?: Partial<CokeCase>) {
    form.reset();
    error.hidden = true;
    editing = item?.id || "";
    for (const name of [
      "title",
      "naturalLanguage",
      "co",
      "ke",
      "notes",
    ] as const)
      field(name).value = item?.[name] || "";
    field("confirmed").checked = !!item?.confirmed;
    form.querySelector<HTMLElement>("#delete-coke")!.hidden = !editing;
    dialog.showModal();
  }
  form.addEventListener("input", (event) => {
    if (event.target !== field("confirmed")) field("confirmed").checked = false;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    const item = {
      id: editing,
      confirmed: field("confirmed").checked,
      ...Object.fromEntries(
        ["title", "naturalLanguage", "co", "ke", "notes"].map((name) => [
          name,
          field(name).value,
        ]),
      ),
    };
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    void api("/api/coke", "PUT", { domain: selected, case: item })
      .then(async () => {
        dialog.close();
        await load();
        host.notify("标准例已保存");
      })
      .catch((e) => {
        error.textContent = e.message;
        error.hidden = false;
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  form.querySelector("#delete-coke")!.addEventListener("click", () =>
    run(async () => {
      await api("/api/coke", "PUT", {
        domain: selected,
        case: { id: editing },
        remove: true,
      });
      dialog.close();
      await load();
    }),
  );
  panel.querySelector("#add-coke")!.addEventListener("click", () => edit());
  panel.querySelector("#document-coke")!.addEventListener("click", () => {
    const ke = host.text();
    edit({
      title: host.workspace().question?.number || host.workspace().domain.name,
      ke,
      naturalLanguage:
        host.workspace().question?.prompt ||
        ke
          .split("\n")
          .filter((s) => /^\s*(--|\/\/)/.test(s))
          .map((s) => s.replace(/^\s*(--|\/\/)\s?/, ""))
          .join("\n"),
    });
  });
  panel
    .querySelector("#check-coke")!
    .addEventListener("click", () => run(load));
  const upload = panel.querySelector<HTMLInputElement>("#coke-file")!;
  panel
    .querySelector("#import-coke")!
    .addEventListener("click", () => upload.click());
  upload.addEventListener("change", () =>
    run(async () => {
      const file = upload.files?.[0];
      upload.value = "";
      if (!file) return;
      const text = await file.text();
      if (file.name.endsWith(".ke")) {
        edit({ title: file.name, ke: text });
        return;
      }
      const input = JSON.parse(text);
      if (!Array.isArray(input))
        throw new Error("请选择导出的标准例 JSON 文件。");
      for (const item of input)
        await api("/api/coke", "PUT", {
          domain: selected,
          case: { ...item, confirmed: false },
        });
      await load();
      host.notify("已导入，人工确认后加入回归");
    }),
  );
  panel.querySelector("#export-coke")!.addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(cases, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = host.workspace().domain.name + "-COKE.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return {
    load,
    sync() {
      if (selected !== host.workspace().domain.id) {
        selected = host.workspace().domain.id;
        run(load);
      }
    },
  };
}
