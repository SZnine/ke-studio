import type {
  Question,
  QuestionSummary,
  Workspace,
} from "../../src/studio/language";
import { api } from "./api";
import { renderMarkdown } from "./markdown";

interface Host {
  workspace(): Workspace;
  save(): Promise<void>;
  open(id: string): Promise<void>;
  apply(state: Workspace, load?: boolean): void;
  tab(value: string): void;
  notify(text: string, error?: boolean): void;
}
export function createQuestions(host: Host) {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  const run = (action: () => Promise<void>) =>
    void action().catch((e) => host.notify(e.message, true));
  const node = (tag: string, text = "") => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  const previewSource = new WeakMap<Element, string>();
  const previewCache = new Map<string, string>();
  const previewObserver = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting || !target.isConnected) continue;
      previewObserver.unobserve(target);
      const source = previewSource.get(target)!;
      let html = previewCache.get(source);
      if (html === undefined) {
        const snippet = document.createElement("template");
        snippet.innerHTML = renderMarkdown(source);
        for (const link of snippet.content.querySelectorAll("a"))
          link.replaceWith(...link.childNodes);
        for (const image of snippet.content.querySelectorAll("img"))
          image.replaceWith(image.alt);
        html = snippet.innerHTML;
        if (previewCache.size >= 128)
          previewCache.delete(previewCache.keys().next().value!);
        previewCache.set(source, html);
      }
      target.innerHTML = html;
    }
  });
  function render() {
    const state = host.workspace();
    const query = $<HTMLInputElement>("#question-search")
      .value.trim()
      .toLowerCase();
    const rows = state.questions.filter((q) =>
      (q.number + "\n" + q.prompt).toLowerCase().includes(query),
    );
    $("#question-count").textContent =
      `${rows.length} / ${state.questions.length} 道题`;
    $("#questions-empty").hidden = rows.length > 0;
    $("#questions-empty").textContent = query
      ? "没有匹配的题目"
      : "添加第一道题，或一次导入多个 KE 文件。";
    const body = $("#question-rows");
    previewObserver.disconnect();
    body.replaceChildren();
    for (const [index, item] of rows.entries()) {
      const row = node("tr");
      row.classList.toggle("selected", item.id === state.question?.id);
      const number = node("td"),
        link = node("button", item.number) as HTMLButtonElement;
      link.className = "question-link";
      link.addEventListener("click", () => run(() => host.open(item.id)));
      number.append(link);
      const prompt = node("td");
      const preview = node("div", item.prompt ? "" : "尚未填写题干");
      preview.className = "question-preview";
      prompt.append(preview);
      if (item.prompt) {
        previewSource.set(preview, item.prompt);
        previewObserver.observe(preview);
      }
      row.append(
        node("td", String(index + 1)),
        number,
        prompt,
        node("td", new Date(item.updated).toLocaleDateString("zh-CN")),
      );
      row.addEventListener("click", (event) => {
        if (!(event.target as HTMLElement).closest("button"))
          run(() => host.open(item.id));
      });
      body.append(row);
    }
    const index = state.questions.findIndex((q) => q.id === state.question?.id);
    $<HTMLButtonElement>("#previous-question").disabled = index <= 0;
    $<HTMLButtonElement>("#next-question").disabled =
      index < 0 || index === state.questions.length - 1;
  }
  $("#question-search").addEventListener("input", render);
  const dialog = $<HTMLDialogElement>("#question-dialog"),
    form = dialog.querySelector<HTMLFormElement>("form")!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  $("#add-question").addEventListener("click", () => {
    form.reset();
    $("#question-error").hidden = true;
    dialog.showModal();
    field("number").focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    void (async () => {
      await host.save();
      const state = host.workspace();
      const result = await api<{
        question: Question;
        questions: QuestionSummary[];
      }>("/api/questions", "POST", {
        domain: state.domain.id,
        question: {
          number: field("number").value.trim() || undefined,
          prompt: field("prompt").value,
        },
      });
      host.apply({ ...state, ...result }, true);
      host.tab("editor");
      dialog.close();
    })()
      .catch((e) => {
        $("#question-error").textContent = e.message;
        $("#question-error").hidden = false;
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  $("#back-questions").addEventListener("click", () =>
    run(async () => {
      await host.save();
      host.tab("questions");
    }),
  );
  for (const [id, direction] of [
    ["previous-question", -1],
    ["next-question", 1],
  ] as const)
    $("#" + id).addEventListener("click", () =>
      run(async () => {
        const state = host.workspace(),
          index = state.questions.findIndex((q) => q.id === state.question?.id);
        const next = state.questions[index + direction];
        if (next) await host.open(next.id);
      }),
    );
  $("#delete-question").addEventListener("click", () =>
    run(async () => {
      await host.save();
      const state = host.workspace();
      if (!state.question) return;
      host.apply(
        await api(
          state.question.draft ? "/api/drafts" : "/api/questions",
          "DELETE",
          {
            domain: state.domain.id,
            id: state.question.id,
          },
        ),
        true,
      );
      host.tab("questions");
      host.notify("题目已删除，可从修改历史恢复。");
    }),
  );
  const input = $<HTMLInputElement>("#question-files");
  $("#import-questions").addEventListener("click", () => input.click());
  input.addEventListener("change", () =>
    run(async () => {
      const files = [...(input.files || [])];
      input.value = "";
      if (!files.length) return;
      await host.save();
      const payload =
        files.length === 1 && files[0].name.endsWith(".json")
          ? { questions: JSON.parse(await files[0].text()) }
          : {
              files: await Promise.all(
                files.map(async (f) => {
                  if (!f.name.toLowerCase().endsWith(".ke"))
                    throw new Error("请选 KE 文件，或单个题库 JSON。");
                  return { name: f.name, text: await f.text() };
                }),
              ),
            };
      host.apply(
        await api("/api/questions/import", "POST", {
          domain: host.workspace().domain.id,
          ...payload,
        }),
      );
      host.tab("questions");
      host.notify("题目已导入");
    }),
  );
  $("#export-questions").addEventListener("click", () =>
    run(async () => {
      await host.save();
      const state = host.workspace();
      const records = await api<Question[]>(
        "/api/questions?domain=" + encodeURIComponent(state.domain.id),
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(records, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = state.domain.name + ".questions.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
  );
  return { render };
}
