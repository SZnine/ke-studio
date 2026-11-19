export function initTheme() {
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const icons = {
    light:
      '<path d="M12 3h.393a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 2.992z"/>',
    dark: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  };
  function apply(theme: "light" | "dark") {
    root.dataset.theme = theme;
    button.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[theme]}</svg>`;
    button.title = theme === "dark" ? "切换为浅色模式" : "切换为深色模式";
    button.setAttribute("aria-label", button.title);
    window.dispatchEvent(new Event("ke-theme"));
  }
  apply(root.dataset.theme === "dark" ? "dark" : "light");
  button.addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("ke-studio.theme", theme);
    apply(theme);
  });
  media.addEventListener("change", () => {
    if (!localStorage.getItem("ke-studio.theme"))
      apply(media.matches ? "dark" : "light");
  });
}
