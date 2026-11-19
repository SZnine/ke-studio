import { completionSearchRank } from "../../src/completion-search";
import { coSignature } from "../../src/studio/co-catalog";
import {
  displayType,
  type Entry,
  type Workspace,
} from "../../src/studio/language";
import { typeParts } from "../../studio/language/types";
import { $, node } from "./ui";

interface Host {
  workspace(): Workspace;
  edit(entry: Entry, source: string): void;
  remove(entry: Entry, source: string): Promise<void>;
  copy(entry: Entry): Promise<void>;
  insert?(entry: Entry): Promise<void>;
  notify(text: string, error?: boolean): void;
}
interface Definition {
  entry: Entry;
  source: string;
  label: string;
  editable: boolean;
}
interface Row extends Definition {
  key: string;
  signature: string;
  sources: string[];
  aliases: string[];
  description?: string;
  usage?: number;
}
type Kind = "all" | "concept" | "operator" | "value";
const kinds: Record<Entry["kind"], string> = {
  concept: "概念",
  operator: "算子",
  constant: "常量",
  object: "全局值",
};
const groups = { concept: "概念", operator: "算子", value: "值" };
const group = (entry: Entry): Exclude<Kind, "all"> =>
  entry.kind === "constant" || entry.kind === "object" ? "value" : entry.kind;
const collator = new Intl.Collator("zh-CN", { numeric: true });
const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase();
const normalizeType = (value: string) => normalize(value).replace(/\s+/g, "");

function definitions(state: Workspace): Definition[] {
  const currentFirst = [...state.libraries].sort(
    (a, b) =>
      Number(b.id === state.domain.id) - Number(a.id === state.domain.id),
  );
  return [
    ...currentFirst.flatMap((library) =>
      library.entries.map((entry) => ({
        entry,
        source: library.id,
        label: library.name,
        editable: true,
      })),
    ),
    ...(state.starterLibraries ?? []).flatMap((library) =>
      library.entries.map((entry) => ({
        entry,
        source: library.id,
        label: library.name,
        editable: false,
      })),
    ),
    ...state.coreEntries.map((entry) => ({
      entry,
      source: "core",
      label: "内置",
      editable: false,
    })),
    ...(state.usedEntries ?? []).map((entry) => ({
      entry,
      source: "used",
      label: "题库记录",
      editable: false,
    })),
  ];
}

function compactSignature(entry: Entry, type: (value: string) => string) {
  if (entry.kind === "operator")
    return `(${entry.params.map((p) => type(p.type) || "?").join(", ")}) → ${type(entry.type) || "?"}`;
  if (entry.kind === "concept")
    return entry.parent ? `<: ${type(entry.parent)}` : "";
  return type(entry.type);
}

function rowsFor(state: Workspace, source: string, all: Definition[]) {
  const type = (value: string) =>
    displayType(value, state.language.editor.typeSyntax);
  const rows = new Map<string, Row>();
  const used = new Map(
    state.usedEntries?.map((entry) => [coSignature(entry), entry.usage]),
  );
  for (const definition of all) {
    if (source !== "all" && definition.source !== source) continue;
    const { entry, label } = definition;
    const signature = coSignature(entry);
    const variant = rows.get(signature);
    if (variant) {
      if (!variant.sources.includes(label)) variant.sources.push(label);
      // Keep the source priority for editing, while indexing equivalent labels and aliases.
      variant.aliases = [
        ...new Set([
          ...variant.aliases,
          ...(entry.aliases ?? []),
          ...(entry.label && entry.label !== variant.entry.label
            ? [entry.label]
            : []),
        ]),
      ];
      variant.description ||= entry.description;
      continue;
    }
    rows.set(signature, {
      ...definition,
      key: signature,
      signature: compactSignature(entry, type),
      sources: [label],
      aliases: entry.aliases ?? [],
      description: entry.description,
      usage: used.get(signature),
    });
  }
  return [...rows.values()];
}

function searchRank(row: Row, query: string) {
  const { entry } = row;
  const normal = completionSearchRank(
    query,
    entry.name,
    [entry.label || "", ...row.aliases],
    [
      row.description || "",
      entry.returnDescription || "",
      ...entry.params.map((p) => p.description || ""),
    ],
  );
  if (normal >= 0) return normal;
  return normalizeType(row.signature).includes(normalizeType(query)) ? 3 : -1;
}

function containsType(type: string, name: string): boolean {
  return (
    type === name ||
    (typeParts(type)?.some((part) => containsType(part, name)) ?? false)
  );
}

export function createDictionary(host: Host) {
  const search = $<HTMLInputElement>("#library-search");
  const source = $<HTMLSelectElement>("#dictionary-source");
  const filters = Array.from(
    $("#kind-filter").querySelectorAll<HTMLButtonElement>(
      "button[data-co-kind]",
    ),
  );
  const list = $("#entries");
  const detail = $("#dictionary-definition");
  let selected = "",
    kind: Kind = "all",
    lastFilter = "";
  let visible: Row[] = [];
  let allRows: Row[] = [];
  const buttons = new Map<string, HTMLButtonElement>();

  function renderSources(state: Workspace) {
    const previous = source.value;
    source.replaceChildren(
      new Option("全部来源", "all"),
      new Option("题库记录", "used"),
      new Option("内置", "core"),
    );
    const sections = [
      ["领域库", state.libraries],
      ["初始 CO", state.starterLibraries ?? []],
    ] as const;
    for (const [label, libraries] of sections) {
      if (!libraries.length) continue;
      const options = node("optgroup");
      options.label = label;
      for (const library of libraries)
        options.append(
          new Option(
            library.name + (library.id === state.domain.id ? "（当前）" : ""),
            library.id,
          ),
        );
      source.append(options);
    }
    source.value = Array.from(source.options).some(
      (option) => option.value === previous,
    )
      ? previous
      : "all";
  }

  function render() {
    const state = host.workspace();
    if (!state) return;
    renderSources(state);
    const all = definitions(state);
    allRows = rowsFor(state, "all", all);
    const query = search.value.trim();
    const filter = JSON.stringify([query, kind, source.value]);
    const results =
      source.value === "all" ? allRows : rowsFor(state, source.value, all);
    const matches = results
      .map((row) => ({ row, rank: searchRank(row, query) }))
      .filter(({ rank }) => rank >= 0)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          collator.compare(
            a.row.entry.label || a.row.entry.name,
            b.row.entry.label || b.row.entry.name,
          ),
      );
    const counts = { all: matches.length, concept: 0, operator: 0, value: 0 };
    for (const { row } of matches) counts[group(row.entry)]++;
    for (const button of filters) {
      const key = button.dataset.coKind as Kind;
      button.textContent = `${key === "all" ? "全部" : groups[key]} ${counts[key]}`;
      button.setAttribute("aria-pressed", String(key === kind));
    }
    visible = matches
      .map(({ row }) => row)
      .filter((row) => kind === "all" || group(row.entry) === kind);
    $("#library-count").textContent = `${visible.length} 项`;
    $("#library-empty").hidden = visible.length > 0;
    const managed =
      state.libraries.find((library) => library.id === source.value)?.name ??
      state.domain.name;
    $("#library-manage-scope").textContent = managed;
    $("#import-library").title = `替换${managed}的 CO 库`;

    const resultsPanel = list.parentElement!;
    const scrollTop = lastFilter === filter ? resultsPanel.scrollTop : 0;
    lastFilter = filter;
    list.replaceChildren();
    buttons.clear();
    if (kind === "all" && !query) {
      for (const key of ["concept", "operator", "value"] as const) {
        const rows = visible.filter((row) => group(row.entry) === key);
        if (!rows.length) continue;
        const heading = node("h2", groups[key], "dictionary-group-title");
        list.append(heading);
        for (const row of rows) list.append(rowButton(row));
      }
    } else for (const row of visible) list.append(rowButton(row));
    resultsPanel.scrollTop = scrollTop;
    if (!visible.some((row) => row.key === selected))
      selected = visible[0]?.key || "";
    select(selected);
  }

  function rowButton(row: Row) {
    const { entry } = row;
    const control = node("button", "", "dictionary-entry");
    control.type = "button";
    control.setAttribute("aria-controls", detail.id);
    const heading = node("span", "", "dictionary-entry-heading");
    heading.append(
      node("strong", entry.label || entry.name),
      node(
        "span",
        entry.draft ? "待完善" : kinds[entry.kind],
        "type-tag " + entry.kind,
      ),
    );
    const declaration = node(
      "code",
      [entry.name, row.signature].filter(Boolean).join(" "),
      "dictionary-row-signature",
    );
    declaration.title = declaration.textContent || "";
    control.append(heading, declaration);
    if (row.description)
      control.append(node("span", row.description, "dictionary-row-summary"));
    control.append(
      node(
        "small",
        row.usage ? `${row.label} · ${row.usage} 份 KE` : row.label,
      ),
    );
    control.addEventListener("click", () => select(row.key, true));
    buttons.set(row.key, control);
    return control;
  }

  function link(text: string, row: Row) {
    const control = node("button", text, "dictionary-link");
    control.type = "button";
    control.title = row.entry.name;
    control.addEventListener("click", () => {
      if (!visible.some((candidate) => candidate.key === row.key)) {
        search.value = "";
        source.value = "all";
        kind = "all";
        selected = row.key;
        render();
      }
      buttons.get(row.key)?.scrollIntoView({ block: "nearest" });
      select(row.key, true);
    });
    return control;
  }

  function listRelations(label: string, rows: Row[]) {
    if (!rows.length) return;
    const container = node("section", "", "dictionary-relations");
    container.append(node("h3", label));
    const links = node("div", "", "dictionary-chips");
    const append = (target: HTMLElement, row: Row) =>
      target.append(link(row.entry.label || row.entry.name, row));
    for (const row of rows.slice(0, 8)) append(links, row);
    container.append(links);
    if (rows.length > 8) {
      const rest = node("details");
      rest.append(node("summary", `其余 ${rows.length - 8} 项`));
      const more = node("div", "", "dictionary-chips");
      for (const row of rows.slice(8)) append(more, row);
      rest.append(more);
      container.append(rest);
    }
    detail.append(container);
  }

  function select(key: string, activate = false) {
    selected = key;
    for (const [id, button] of buttons) {
      button.classList.toggle("selected", id === key);
      button.setAttribute("aria-pressed", String(id === key));
    }
    const row = visible.find((result) => result.key === key);
    const scrollTop = detail.dataset.activeKey === key ? detail.scrollTop : 0;
    detail.dataset.activeKey = key;
    detail.replaceChildren();
    detail.hidden = !row;
    if (!row) return;
    const state = host.workspace();
    const { entry } = row;
    const type = (value: string) =>
      displayType(value, state.language.editor.typeSyntax);
    const title = node("header", "", "dictionary-detail-header");
    const meta = [
      kinds[entry.kind],
      ...row.sources,
      row.usage ? `见于 ${row.usage} 份 KE` : "",
    ].filter(Boolean);
    title.append(
      node("p", meta.join(" · "), "dictionary-eyebrow"),
      node("h2", entry.label || entry.name),
    );
    if (row.description)
      title.append(node("p", row.description, "dictionary-description"));
    if (entry.draft)
      title.append(node("p", "补齐参数和返回类型后可以用于补全。", "muted"));
    detail.append(title);

    const actions = node("div", "", "dictionary-actions");
    function action(
      label: string,
      handler: () => void | Promise<void>,
      style = "button",
    ) {
      const control = node("button", label, style);
      control.type = "button";
      control.addEventListener("click", () => {
        control.disabled = true;
        void Promise.resolve()
          .then(handler)
          .catch((error: unknown) => {
            host.notify(
              error instanceof Error ? error.message : String(error),
              true,
            );
          })
          .finally(() => {
            control.disabled = false;
          });
      });
      actions.append(control);
    }
    if (!entry.draft) {
      if (
        host.insert &&
        state.question &&
        state.editorEntries.some((option) => coSignature(option) === row.key)
      ) {
        const insert = host.insert;
        action("插入当前 KE", () => insert(entry), "button primary");
      }
      action("复制声明", () => host.copy(entry));
    }
    if (row.editable) {
      action(
        entry.draft ? "补齐签名" : "编辑",
        () => host.edit(entry, row.source),
        "text-button",
      );
      action(
        "删除",
        () => host.remove(entry, row.source),
        "text-button danger",
      );
    }
    if (actions.childElementCount) detail.append(actions);

    const signature =
      entry.kind === "operator"
        ? `op ${entry.name}(${entry.params.map((param) => `${param.name ? `${param.name}: ` : ""}${type(param.type) || "?"}`).join(", ")}) : ${type(entry.type) || "?"};`
        : entry.kind === "concept"
          ? `concept ${entry.name}${entry.parent ? ` <: ${type(entry.parent)}` : ""};`
          : `${entry.name} : ${type(entry.type)};`;
    detail.append(node("pre", signature, "dictionary-signature"));
    if (entry.kind === "operator") {
      const terms = node("dl", "", "dictionary-parameters");
      const describe = (name: string, value: string, description?: string) => {
        const label = node("dt", name);
        const meaning = node("dd");
        const target = allRows.find(
          (item) => item.entry.kind === "concept" && item.entry.name === value,
        );
        meaning.append(
          target
            ? link(type(value), target)
            : node("code", type(value) || "未填写"),
        );
        if (description) meaning.append(node("span", description));
        terms.append(label, meaning);
      };
      for (const [i, param] of entry.params.entries())
        describe(param.name || `参数 ${i + 1}`, param.type, param.description);
      describe("返回", entry.type, entry.returnDescription);
      detail.append(terms);
    }
    const aliases = row.aliases.filter(
      (alias) => alias !== entry.name && alias !== entry.label,
    );
    if (aliases?.length)
      detail.append(
        node("p", `别名 ${aliases.join("、")}`, "dictionary-aliases"),
      );
    if (entry.kind === "concept") {
      listRelations(
        "上位概念",
        allRows.filter(
          (item) =>
            item.entry.kind === "concept" && item.entry.name === entry.parent,
        ),
      );
      listRelations(
        "下位概念",
        allRows.filter(
          (item) =>
            item.entry.kind === "concept" && item.entry.parent === entry.name,
        ),
      );
      listRelations(
        "接受此类型的算子",
        allRows.filter(
          (item) =>
            item.entry.kind === "operator" &&
            item.entry.params.some((p) => containsType(p.type, entry.name)),
        ),
      );
      listRelations(
        "返回此类型的算子",
        allRows.filter(
          (item) =>
            item.entry.kind === "operator" &&
            containsType(item.entry.type, entry.name),
        ),
      );
    }
    const variants = allRows.filter(
      (item) => item.entry.name === entry.name && item.key !== row.key,
    );
    if (variants.length) {
      const section = node("section", "", "dictionary-variants");
      section.append(node("h3", "同名定义"));
      for (const item of variants)
        section.append(
          link(
            `${item.label} · ${item.signature || kinds[item.entry.kind]}`,
            item,
          ),
        );
      detail.append(section);
    }
    detail.scrollTop = scrollTop;
    if (activate && window.matchMedia("(max-width: 760px)").matches)
      detail.focus();
  }

  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.isComposing || !visible.length) return;
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      buttons.get(selected)?.focus();
    }
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const entries = Array.from(
      list.querySelectorAll<HTMLButtonElement>(".dictionary-entry"),
    );
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next = entries[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
  for (const button of filters)
    button.addEventListener("click", () => {
      kind = button.dataset.coKind as Kind;
      render();
    });
  source.addEventListener("change", render);
  return { render };
}
