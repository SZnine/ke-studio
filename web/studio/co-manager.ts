import { api } from "./api";
import { createDictionary } from "./dictionary";
import {
  $,
  button,
  download,
  field,
  formError,
  modal,
  node,
  notify,
  run,
} from "./ui";
import {
  displayType,
  entryKey,
  type Entry,
  type Workspace,
} from "../../src/studio/language";

interface Host {
  workspace(): Workspace;
  refresh(): Promise<void>;
  click(selector: string, action: () => unknown | Promise<unknown>): void;
}

export function createCoManager({ workspace, refresh, click }: Host) {
  const formatType = (type: string) =>
    displayType(type, workspace().language.editor.typeSyntax);
  const managedDomain = () => {
    const value = $<HTMLSelectElement>("#dictionary-source").value;
    return workspace().libraries.some((lib) => lib.id === value)
      ? value
      : workspace().domain.id;
  };
  const currentLibrary = () =>
    workspace().libraries.find((library) => library.id === managedDomain())!;
  const dictionary = createDictionary({
    workspace,
    edit: editEntry,
    copy: async (entry) => {
      const text = await api<string>("/api/co/declaration", "POST", { entry });
      await navigator.clipboard.writeText(text);
      notify("已复制 CO 声明");
    },
    notify,
    remove: async (entry, source) => {
      await api("/api/library", "PUT", {
        domain: source,
        edits: [{ key: entryKey(entry), entry: null }],
        reason: `删除 CO：${entry.name}`,
      });
      await refresh();
      notify("已删除，可从修改历史恢复。");
    },
  });
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
    entryForm
      .querySelectorAll<HTMLElement>("[data-kind]")
      .forEach((element) => {
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
    field(entryForm, "type").value = entry ? formatType(entry.type) : "";
    $("#parameters").replaceChildren();
    for (const param of entry?.params || [])
      parameterRow({
        name: param.name,
        type: formatType(param.type),
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
      const params = [
        ...$("#parameters").querySelectorAll(".parameter-row"),
      ].map(
        (row) =>
          Object.fromEntries(
            [...row.querySelectorAll<HTMLInputElement>("input")].map(
              (input) => [input.dataset.param!, input.value.trim()],
            ),
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
      await refresh();
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
        await refresh();
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
        await api("/api/usage", "PUT", {
          domain: workspace().domain.id,
          files: data,
        });
        await refresh();
        notify(`已统计 ${files.length} 个文件的实际引用，声明不计入。`);
      }),
  );
  return { render: dictionary.render };
}
