/** Shared pointer/keyboard resizing for workspace boundaries. */
export function initLayout() {
  const root = document.documentElement;
  const size = (selector: string) =>
    document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
  const sidebarWidth = () => size(".sidebar").width;
  const chatWidth = () =>
    document.body.classList.contains("chat-open") && innerWidth > 1050
      ? size(".chat-panel").width
      : 0;
  const specs = [
    {
      name: "sidebar",
      selector: ".sidebar",
      label: "调整左侧栏宽度",
      edge: "right",
      initial: 220,
      min: 155,
      max: () => Math.min(420, innerWidth - chatWidth() - 320),
    },
    {
      name: "chat",
      selector: ".chat-panel",
      label: "调整对话栏宽度",
      edge: "left",
      initial: 420,
      min: 300,
      max: () =>
        innerWidth > 1050 ? innerWidth - sidebarWidth() - 320 : innerWidth,
    },
    {
      name: "source",
      selector: ".source-pane",
      label: "调整原文栏宽度",
      edge: "left",
      initial: 350,
      min: 230,
      max: () => size(".annotation-workspace").width - 300,
    },
    {
      name: "diagnostics",
      selector: ".diagnostics",
      label: "调整底部检查栏高度",
      edge: "top",
      initial: 86,
      min: 34,
      max: () => size(".diagnostics").height + size("#editor").height - 170,
    },
  ] as const;
  const refresh: (() => void)[] = [];
  for (const spec of specs) {
    const panel = document.querySelector<HTMLElement>(spec.selector)!;
    const horizontal = spec.edge === "top";
    const handle = document.createElement("div");
    handle.className = `resize-handle resize-${spec.edge}`;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", spec.label);
    handle.setAttribute(
      "aria-orientation",
      horizontal ? "horizontal" : "vertical",
    );
    handle.title = spec.label + " · 双击恢复默认";
    panel.id ||= spec.name + "-panel";
    handle.setAttribute("aria-controls", panel.id);
    if (horizontal) panel.before(handle);
    else panel.append(handle);
    const key = `ke-studio.size.${spec.name}`;
    let preferred = Number(localStorage.getItem(key)) || spec.initial;
    let drag: { pointer: number; start: number; value: number } | undefined;
    const dimension = () =>
      panel.getBoundingClientRect()[horizontal ? "height" : "width"];
    const apply = (value: number, save = false) => {
      const maximum = Math.max(spec.min, spec.max());
      const next = Math.round(Math.max(spec.min, Math.min(maximum, value)));
      root.style.setProperty(
        `--${spec.name}-${horizontal ? "height" : "width"}`,
        next + "px",
      );
      handle.setAttribute("aria-valuemin", String(spec.min));
      handle.setAttribute("aria-valuemax", String(Math.round(maximum)));
      handle.setAttribute("aria-valuenow", String(next));
      if (save) localStorage.setItem(key, String((preferred = next)));
    };
    const fit = () => {
      if (!drag && panel.getClientRects().length) apply(preferred);
    };
    refresh.push(fit);
    fit();
    const position = (event: PointerEvent) =>
      horizontal ? event.clientY : event.clientX;
    const expand = () => {
      if (spec.name !== "diagnostics") return;
      panel.classList.remove("collapsed");
      const toggle = document.querySelector("#toggle-issues")!;
      toggle.textContent = "收起";
      toggle.setAttribute("aria-expanded", "true");
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      expand();
      drag = {
        pointer: event.pointerId,
        start: position(event),
        value: dimension(),
      };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
      document.body.dataset.resizing = horizontal ? "row" : "col";
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      apply(
        drag.value +
          (position(event) - drag.start) * (spec.edge === "right" ? 1 : -1),
      );
    });
    const finish = () => {
      if (!drag) return;
      drag = undefined;
      apply(dimension(), true);
      handle.classList.remove("dragging");
      delete document.body.dataset.resizing;
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("dblclick", () => {
      expand();
      apply(spec.initial, true);
    });
    handle.addEventListener("keydown", (event) => {
      const keys = horizontal
        ? ["ArrowUp", "ArrowDown"]
        : ["ArrowLeft", "ArrowRight"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      expand();
      const direction = event.key === keys[0] ? -1 : 1;
      apply(
        dimension() +
          direction *
            (spec.edge === "right" ? 1 : -1) *
            (event.shiftKey ? 48 : 16),
        true,
      );
    });
  }
  const fit = () => refresh.forEach((update) => update());
  window.addEventListener("resize", fit);
  new MutationObserver(fit).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  new ResizeObserver(fit).observe(document.querySelector("#editor")!);
}
