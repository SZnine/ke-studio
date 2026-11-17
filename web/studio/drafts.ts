import type {
  Question,
  QuestionSummary,
  Workspace,
} from "../../src/studio/language";
import { api } from "./api";

export function createDrafts(host: {
  workspace(): Workspace;
  save(): Promise<void>;
  open(id: string, draft?: boolean): Promise<void>;
  apply(state: Workspace, load?: boolean): void;
  tab(name: string): void;
  notify(text: string, error?: boolean): void;
}) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.querySelector<T>("#" + id)!;
  const run = (action: () => Promise<void>) =>
    void action().catch((e) => host.notify(e.message, true));
  function render() {
    const state = host.workspace(),
      list = $("drafts");
    list.replaceChildren();
    for (const draft of state.drafts) {
      const button = document.createElement("button");
      button.textContent = draft.number;
      button.classList.toggle("active", state.question?.id === draft.id);
      button.addEventListener("click", () =>
        run(() => host.open(draft.id, true)),
      );
      list.append(button);
    }
    $("draft-empty").hidden = state.drafts.length > 0;
    $("draft-scope-label").hidden = !state.question?.draft;
    const scope = $<HTMLSelectElement>("draft-scope");
    scope.replaceChildren(
      new Option("全领域 CO", "all"),
      ...state.domains
        .filter((d) => d.id !== "common")
        .map((d) => new Option(d.name + "（含父级）", d.id)),
    );
    scope.value = state.domains.some((d) => d.id === state.question?.coScope)
      ? state.question!.coScope!
      : "all";
    $("publish-draft").hidden = !state.question?.draft;
    $("draft-label").hidden = !state.question?.draft;
    $("previous-question").hidden = !!state.question?.draft;
    $("next-question").hidden = !!state.question?.draft;
    $("question-number").setAttribute(
      "aria-label",
      state.question?.draft ? "草稿名称" : "题号",
    );
  }
  $("new-draft").addEventListener("click", () =>
    run(async () => {
      await host.save();
      const state = host.workspace();
      const result = await api<{
        question: Question;
        questions: QuestionSummary[];
        drafts: QuestionSummary[];
      }>("/api/drafts", "POST", { domain: state.domain.id, question: {} });
      host.apply(
        await api(
          `/api/state?domain=${state.domain.id}&question=${result.question.id}&draft=true`,
        ),
        true,
      );
      host.tab("editor");
      $("question-prompt").focus();
    }),
  );
  const dialog = $<HTMLDialogElement>("publish-dialog"),
    form = dialog.querySelector("form")!;
  $("publish-draft").addEventListener("click", () => {
    form.reset();
    const target = form.elements.namedItem("target") as HTMLSelectElement;
    target.replaceChildren(
      ...host
        .workspace()
        .domains.filter((d) => d.id !== "common")
        .map((d) => new Option(d.name, d.id)),
    );
    target.value = host.workspace().domain.id;
    $("publish-error").hidden = true;
    dialog.showModal();
    form.querySelector("input")!.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    void (async () => {
      await host.save();
      const state = host.workspace();
      if (!state.question?.draft) return;
      host.apply(
        await api("/api/drafts/publish", "POST", {
          domain: state.domain.id,
          id: state.question.id,
          number: form.querySelector("input")!.value,
          target: (form.elements.namedItem("target") as HTMLSelectElement)
            .value,
        }),
        true,
      );
      dialog.close();
      host.notify("已存入题库");
    })()
      .catch((e) => {
        $("publish-error").textContent = e.message;
        $("publish-error").hidden = false;
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  $("draft-scope").addEventListener("change", () =>
    run(async () => {
      const state = host.workspace();
      if (!state.question?.draft) return;
      state.question.coScope = $<HTMLSelectElement>("draft-scope").value;
      await host.save();
      await api("/api/drafts", "PUT", {
        domain: state.domain.id,
        question: { id: state.question.id, coScope: state.question.coScope },
      });
      host.apply(
        await api(
          `/api/state?domain=${state.domain.id}&question=${state.question.id}&draft=true`,
        ),
      );
    }),
  );
  return { render };
}
