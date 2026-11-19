import { completionSearchRank } from "../../src/completion-search";
import { coSignature } from "../../src/studio/co-catalog";
import {
  displayType,
  type Entry,
  type Workspace,
} from "../../src/studio/language";

interface Host {
  workspace(): Workspace;
  edit(entry: Entry, source: string): void;
  remove(entry: Entry, source: string): Promise<void>;
  copy(entry: Entry): Promise<void>;
  notify(text: string, error?: boolean): void;
}
const kinds: Record<string, string> = {
  concept: "概念",
  operator: "算子",
  constant: "常量",
  object: "全局值",
};
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

export function createDictionary(host: Host) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.querySelector<T>("#" + id)!;
  let selected = "";
  function render() {
    const state = host.workspace();
    if (!state) return;
    const query = $<HTMLInputElement>("library-search").value.trim();
    const kind = $<HTMLSelectElement>("kind-filter").value;
    const sourceSelect = $<HTMLSelectElement>("dictionary-source");
    const previousSource = sourceSelect.value;
    sourceSelect.replaceChildren(
      new Option("全部可用词条", "all"),
      new Option("当前领域", "current"),
      new Option("已在题库使用", "used"),
      ...state.libraries
        .filter((lib) => lib.id !== state.domain.id)
        .map((lib) => new Option(lib.name, lib.id)),
      new Option("内置", "core"),
    );
    sourceSelect.value = [...sourceSelect.options].some(
      (option) => option.value === previousSource,
    )
      ? previousSource
      : "all";
    const source = $<HTMLSelectElement>("dictionary-source").value;
    const defined = [
      ...state.libraries.flatMap((library) =>
        library.entries.map((entry) => ({
          entry,
          source: library.id,
          label: library.name,
        })),
      ),
      ...state.coreEntries.map((entry) => ({
        entry,
        source: "core",
        label: "内置",
      })),
    ];
    const known = new Set(defined.map(({ entry }) => coSignature(entry)));
    const used = (state.usedEntries ?? [])
      .filter((entry) => source === "used" || !known.has(coSignature(entry)))
      .map((entry) => ({ entry, source: "used", label: "题库记录" }));
    const rows = [...defined, ...used]
      .map((item) => ({
        ...item,
        key: item.source + ":" + coSignature(item.entry),
        rank: completionSearchRank(
          query,
          item.entry.name,
          [item.entry.label || "", ...(item.entry.aliases || [])],
          [item.entry.description || ""],
        ),
      }))
      .filter(
        (item) =>
          item.rank >= 0 &&
          (kind === "all" || item.entry.kind === kind) &&
          (source === "all" ||
            item.source === (source === "current" ? state.domain.id : source)),
      )
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.source === state.domain.id ? 0 : a.source === "common" ? 1 : 2) -
            (b.source === state.domain.id
              ? 0
              : b.source === "common"
                ? 1
                : 2) ||
          a.entry.name.localeCompare(b.entry.name),
      );
    $("library-count").textContent = `${rows.length} 个词条`;
    $("library-hint").textContent = "检索领域 CO 和题库中的声明";
    $("library-manage-scope").textContent =
      source === "common" ? "通用库" : "当前领域字典";
    $("import-library").title =
      "替换" +
      (source === "common" ? "通用库" : "当前领域字典") +
      "，原内容保留在修改历史中";
    $("library-empty").hidden = rows.length > 0;
    if (!rows.some((item) => item.key === selected))
      selected = rows[0]?.key || "";
    const list = $("entries");
    list.replaceChildren();
    for (const item of rows) {
      const button = node("button", "", "dictionary-entry");
      button.classList.toggle("selected", item.key === selected);
      button.setAttribute("aria-pressed", String(item.key === selected));
      const heading = node("span", "", "dictionary-entry-heading");
      heading.append(
        node("strong", item.entry.name),
        node(
          "span",
          item.entry.draft ? "待完善" : kinds[item.entry.kind],
          "type-tag " + item.entry.kind,
        ),
      );
      button.append(
        heading,
        node(
          "small",
          [item.entry.label, item.label].filter(Boolean).join(" · "),
        ),
      );
      button.addEventListener("click", () => {
        selected = item.key;
        render();
      });
      list.append(button);
    }
    const detail = $("dictionary-definition");
    detail.replaceChildren();
    const item = rows.find((r) => r.key === selected);
    if (!item) {
      detail.append(node("p", "选择词条查看定义", "muted"));
      return;
    }
    const { entry } = item;
    const type = (value: string) =>
      displayType(value, state.language.editor.typeSyntax);
    detail.append(
      node(
        "span",
        kinds[entry.kind] + " · " + item.label,
        "dictionary-eyebrow",
      ),
      node("h2", entry.name),
    );
    if (entry.label) detail.append(node("p", entry.label, "dictionary-label"));
    const signature =
      entry.kind === "operator"
        ? `${entry.name}(${entry.params.map((p) => `${p.name} : ${type(p.type) || "未填写"}`).join(", ")}) : ${type(entry.type) || "未填写"}`
        : entry.kind === "concept"
          ? entry.name + (entry.parent ? " <: " + entry.parent : "")
          : `${entry.name} : ${type(entry.type)}`;
    detail.append(node("pre", signature, "dictionary-signature"));
    if (entry.draft)
      detail.append(
        node(
          "p",
          "待完善 CO：输入类型或返回类型尚未补齐，暂不参与代码补全和类型检查。",
          "muted",
        ),
      );
    if (entry.description) detail.append(node("p", entry.description));
    if (entry.params.length || entry.returnDescription) {
      const terms = node("dl");
      for (const param of entry.params)
        terms.append(
          node("dt", `${param.name} · ${type(param.type)}`),
          node("dd", param.description || "—"),
        );
      if (entry.kind === "operator")
        terms.append(
          node("dt", "返回 · " + type(entry.type)),
          node("dd", entry.returnDescription || "—"),
        );
      detail.append(terms);
    }
    if (entry.aliases?.length)
      detail.append(node("p", "别名：" + entry.aliases.join("、"), "muted"));
    const usage =
      item.source === "used"
        ? entry.usage
        : (state.usage[entry.name] ?? entry.usage);
    const metadata = [
      usage === undefined
        ? ""
        : item.source === "used"
          ? `见于 ${usage} 份 KE`
          : `引用 ${usage} 次`,
      entry.updated ? "更新于 " + entry.updated : "",
    ].filter(Boolean);
    if (metadata.length)
      detail.append(node("small", metadata.join(" · "), "muted"));
    const actions = node("div", "", "dictionary-actions");
    if (!entry.draft) {
      const copy = node("button", "复制声明", "button");
      copy.addEventListener(
        "click",
        () =>
          void host
            .copy(entry)
            .catch((error: Error) => host.notify(error.message, true)),
      );
      actions.append(copy);
    }
    if (item.source !== "core" && item.source !== "used") {
      const edit = node(
        "button",
        entry.draft ? "补齐签名" : "编辑词条",
        "button",
      );
      edit.addEventListener("click", () => host.edit(entry, item.source));
      actions.append(edit);
      const remove = node("button", "删除", "text-button danger");
      remove.addEventListener(
        "click",
        () =>
          void host
            .remove(entry, item.source)
            .catch((e) => host.notify(e.message, true)),
      );
      actions.append(remove);
    }
    detail.append(actions);
  }
  $("library-search").addEventListener("input", render);
  for (const id of ["kind-filter", "dictionary-source"])
    $(id).addEventListener("change", render);
  return { render };
}
