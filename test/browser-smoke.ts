import { api, connect } from "../web/studio/api";
import { savePreference } from "../src/studio/preferences";
import type { Question, Workspace } from "../src/studio/language";
const report = document.querySelector("pre")!;
function check(value: unknown, name: string) {
  if (!value) throw new Error(name);
  report.textContent += "PASS " + name + "\n";
}
let folder: FileSystemDirectoryHandle;
document.querySelector("button")!.onclick = async () => {
  report.textContent = "";
  try {
    folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("ke-test-" + crypto.randomUUID(), { create: true });
    let state = await connect(folder);
    check(
      !state.language.error && state.language.revision,
      "Browser WASM compiles the published language",
    );
    const conic = state.domains.find((d) => d.name.includes("圆锥"))!;
    state = await api("/api/domains", "POST", { name: "父领域" });
    const parent = state.domain.id;
    await api("/api/library", "PUT", {
      domain: parent,
      text: "concept ParentShape;\nop parent_measure(ParentShape): Real;",
    });
    state = await api("/api/domains", "POST", { name: "子领域", parent });
    const child = state.domain.id;
    check(
      state.libraries.some((lib) => lib.id === parent),
      "Child includes parent CO",
    );
    let result = await api<any>("/api/analyze", "POST", {
      domain: child,
      text: "op ",
      offset: 3,
    });
    check(
      result.completions.some((c: any) => c.name === "parent_measure"),
      "Operator completion consumes parent CO",
    );
    const { question } = await api<{ question: Question }>(
      "/api/questions",
      "POST",
      {
        domain: child,
        question: {
          number: "T-01",
          prompt: "独立题库验证",
          ke: "concept ParentShape;",
        },
      },
    );
    const original = state.storage.bank;
    state = await api("/api/banks", "POST", { name: "第二题库" });
    check(
      state.domains.some((d) => d.id === child),
      "Banks share the domain tree",
    );
    check(
      (await api<Question[]>("/api/questions?domain=" + child)).length === 0,
      "Question banks are isolated",
    );
    await api("/api/banks", "PUT", { id: original });
    check(
      (await api<Question[]>("/api/questions?domain=" + child))[0].id ===
        question.id,
      "First bank retains its question",
    );
    const draft = await api<{ question: Question }>("/api/drafts", "POST", {
      domain: child,
      question: {},
    });
    state = await api(
      `/api/state?domain=${child}&question=${draft.question.id}&draft=true`,
    );
    check(
      state.libraries.some((lib) => lib.id === conic.id),
      "Draft defaults to all-domain CO",
    );
    result = await api<any>("/api/analyze", "POST", {
      domain: child,
      questionId: draft.question.id,
      draft: true,
      text: "concept Hy",
      offset: 10,
    });
    check(
      result.completions.some((c: any) => c.name === "Hyperbola"),
      "All-domain draft provides conic completion",
    );
    await api("/api/drafts", "PUT", {
      domain: child,
      question: { id: draft.question.id, coScope: parent },
    });
    state = await api(
      `/api/state?domain=${child}&question=${draft.question.id}&draft=true`,
    );
    check(
      !state.libraries.some((lib) => lib.id === conic.id),
      "Draft can narrow its CO scope",
    );
    await api("/api/domains", "PUT", {
      domain: child,
      id: child,
      target: null,
      position: "inside",
      name: "独立子领域",
    });
    result = await api<any>("/api/analyze", "POST", {
      domain: child,
      text: "op ",
      offset: 3,
    });
    check(
      !result.completions.some((c: any) => c.name === "parent_measure"),
      "Moving a domain immediately changes completion scope",
    );
    await api("/api/domains", "PUT", {
      domain: child,
      id: child,
      target: parent,
      position: "inside",
    });
    await api("/api/domains", "DELETE", { domain: parent, id: parent });
    const history = await api<any[]>("/api/history");
    await api("/api/history/restore", "POST", {
      id: history.find((item) => item.file === "domain-delete").id,
    });
    check(
      (await api<Question[]>("/api/questions?domain=" + child))[0].id ===
        question.id,
      "Deleted hierarchy restores its question data",
    );
    state = await api("/api/state?domain=" + parent);
    const localReadme =
      state.language.files["README.md"] + "\nLocal smoke check.\n";
    state = await api("/api/language", "PUT", {
      domain: parent,
      files: { "README.md": localReadme },
      revision: state.language.revision,
    });
    check(
      state.language.files["README.md"] === localReadme &&
        !state.language.error,
      "Editable language recompiles inside browser",
    );
    state = await connect(folder);
    check(
      state.language.files["README.md"] === localReadme &&
        state.domains.some((d) => d.id === child),
      "Reopening never overwrites local changes with templates",
    );
    await savePreference("folder", folder);
    report.textContent += "\nALL BROWSER CHECKS PASSED";
    document.querySelector<HTMLAnchorElement>("a")!.hidden = false;
  } catch (error) {
    report.textContent +=
      "\nFAIL " + (error instanceof Error ? error.stack : error);
  }
};
