import type { Domain, Workspace } from "../../src/studio/language";
import { ancestors } from "../../src/studio/domains";
import { api } from "./api";

export function createDomains(host: {
  workspace(): Workspace;
  save(): Promise<void>;
  apply(state: Workspace, load?: boolean): void;
  tab(name: string): void;
  notify(text: string, error?: boolean): void;
}) {
  const tree = document.querySelector<HTMLElement>("#domains")!;
  const dialog = document.querySelector<HTMLDialogElement>("#domain-dialog")!;
  const form = dialog.querySelector("form")!;
  const name = form.elements.namedItem("name") as HTMLInputElement;
  const parent = form.elements.namedItem("parent") as HTMLSelectElement;
  const menu = document.createElement("div");
  menu.className = "domain-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  document.body.append(menu);
  let editing: Domain | undefined,
    dragging = "";
  const collapsed = new Set<string>();
  const run = (operation: () => Promise<unknown>) =>
    void operation().catch((e) => host.notify(e.message, true));
  const button = (label: string, action: () => void) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.type = "button";
    button.onclick = action;
    return button;
  };
  function edit(item?: Domain, parentId = "") {
    editing = item;
    form.reset();
    dialog.querySelector("h2")!.textContent = item ? "编辑领域" : "新增领域";
    name.value = item?.name || "";
    parent.replaceChildren(new Option("顶层领域", ""));
    for (const d of host
      .workspace()
      .domains.filter(
        (d) =>
          d.id !== "common" &&
          (!item ||
            !ancestors(host.workspace().domains, d.id).includes(item.id)),
      ))
      parent.add(new Option(d.name, d.id));
    parent.value = item?.parent || parentId;
    dialog.querySelector<HTMLElement>(".form-error")!.hidden = true;
    dialog.showModal();
    name.focus();
  }
  document
    .querySelector("#add-domain")!
    .addEventListener("click", () => edit());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async () => {
      await host.save();
      const state = host.workspace();
      try {
        const next = editing
          ? await api("/api/domains", "PUT", {
              domain: state.domain.id,
              id: editing.id,
              name: name.value,
              target: parent.value || null,
              position: "inside",
            })
          : await api("/api/domains", "POST", {
              name: name.value,
              parent: parent.value || undefined,
            });
        host.apply(next, !editing);
        if (!editing) host.tab("questions");
        dialog.close();
      } catch (error) {
        const field = dialog.querySelector<HTMLElement>(".form-error")!;
        field.textContent = (error as Error).message;
        field.hidden = false;
      }
    });
  });
  async function move(
    id: string,
    target: string | null,
    position: "before" | "inside" | "after",
  ) {
    await host.save();
    host.apply(
      await api("/api/domains", "PUT", {
        domain: host.workspace().domain.id,
        id,
        target,
        position,
      }),
    );
  }
  function openMenu(event: MouseEvent, item: Domain) {
    event.preventDefault();
    menu.replaceChildren();
    for (const [label, action] of [
      ["新增子领域", () => edit(undefined, item.id)],
      ["重命名 / 移动", () => edit(item)],
      ["移到顶层", () => run(() => move(item.id, null, "inside"))],
      [
        "删除领域",
        () =>
          run(async () => {
            if (
              !confirm(
                `删除“${item.name}”及其子领域？关联题目和 CO 会移入本地回收区，可从修改历史恢复。`,
              )
            )
              return;
            await host.save();
            host.apply(
              await api("/api/domains", "DELETE", {
                domain: host.workspace().domain.id,
                id: item.id,
              }),
              true,
            );
            host.tab("questions");
          }),
      ],
    ] as const) {
      const entry = button(label, () => {
        menu.hidden = true;
        action();
      });
      entry.setAttribute("role", "menuitem");
      menu.append(entry);
    }
    menu.hidden = false;
    menu.style.left = Math.min(event.clientX, innerWidth - 190) + "px";
    menu.style.top = Math.min(event.clientY, innerHeight - 180) + "px";
    menu.querySelector("button")!.focus();
  }
  document.addEventListener("pointerdown", (e) => {
    if (!menu.contains(e.target as Node)) menu.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menu.hidden = true;
  });
  function render() {
    const state = host.workspace();
    tree.replaceChildren();
    tree.setAttribute("role", "tree");
    function children(parentId: string | undefined, depth: number) {
      for (const item of state.domains.filter(
        (d) => d.id !== "common" && d.parent === parentId,
      )) {
        const row = document.createElement("div");
        row.className = "domain-row";
        row.draggable = true;
        row.dataset.id = item.id;
        row.style.setProperty("--depth", String(depth));
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        const hasChildren = state.domains.some((d) => d.parent === item.id);
        const toggle = button(
          hasChildren ? (collapsed.has(item.id) ? "▸" : "▾") : "·",
          () => {
            collapsed.has(item.id)
              ? collapsed.delete(item.id)
              : collapsed.add(item.id);
            render();
          },
        );
        toggle.className = "domain-toggle";
        toggle.disabled = !hasChildren;
        toggle.setAttribute("aria-label", "展开或收起 " + item.name);
        if (hasChildren)
          row.setAttribute("aria-expanded", String(!collapsed.has(item.id)));
        const select = button(item.name, () =>
          run(async () => {
            if (item.id === host.workspace().domain.id) return;
            await host.save();
            host.apply(
              await api("/api/state?domain=" + encodeURIComponent(item.id)),
              true,
            );
            localStorage.setItem("ke-studio.domain", item.id);
            host.tab("questions");
          }),
        );
        select.className = "domain-name";
        select.title = item.name;
        row.classList.toggle("active", item.id === state.domain.id);
        row.setAttribute("aria-selected", String(item.id === state.domain.id));
        row.append(toggle, select);
        const more = button("⋯", () => {});
        more.className = "domain-more";
        more.setAttribute("aria-label", item.name + " 的操作");
        more.onclick = (event) => openMenu(event, item);
        row.append(more);
        row.oncontextmenu = (event) => openMenu(event, item);
        row.ondragstart = (event) => {
          dragging = item.id;
          event.dataTransfer!.setData("text/plain", item.id);
          event.dataTransfer!.effectAllowed = "move";
          tree.classList.add("dragging");
        };
        row.ondragover = (event) => {
          if (!dragging || dragging === item.id) return;
          event.preventDefault();
          const rect = row.getBoundingClientRect(),
            ratio = (event.clientY - rect.top) / rect.height;
          row.dataset.drop =
            ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
        };
        row.ondragleave = () => delete row.dataset.drop;
        row.ondrop = (event) => {
          event.preventDefault();
          const position = row.dataset.drop as "before" | "inside" | "after";
          delete row.dataset.drop;
          if (dragging && position)
            run(() => move(dragging, item.id, position));
        };
        row.ondragend = () => {
          dragging = "";
          tree.classList.remove("dragging");
          tree
            .querySelectorAll("[data-drop]")
            .forEach((n) => n.removeAttribute("data-drop"));
        };
        tree.append(row);
        if (!collapsed.has(item.id)) children(item.id, depth + 1);
      }
    }
    children(undefined, 0);
    const root = document.createElement("div");
    root.className = "domain-root-drop";
    root.textContent = "移到顶层";
    root.ondragover = (event) => event.preventDefault();
    root.ondrop = (event) => {
      event.preventDefault();
      if (dragging) run(() => move(dragging, null, "inside"));
    };
    tree.append(root);
  }
  return { render };
}
