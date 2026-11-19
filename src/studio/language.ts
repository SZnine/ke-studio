// Shared contracts between the editor and the local language worker.
export type { Entry } from "../../studio/language/ontology";
import type { Entry } from "../../studio/language/ontology";
export interface Domain {
  id: string;
  name: string;
  parent?: string;
}
export interface LibrarySource extends Domain {
  text: string;
  entries: Entry[];
}
export interface LanguageState {
  revision: string;
  version: string;
  tokenTypes: string[];
  editor: {
    brackets: string[][];
    triggers: string[];
    typeSyntax?: { set: string; open: string; close: string };
  };
}
export interface Workspace {
  storage: {
    folder: string;
    bank: string;
    banks: { id: string; name: string }[];
  };
  version: string;
  domain: Domain;
  domains: Domain[];
  language: LanguageState;
  /** Identifies the prepared in-memory CO scope used by the editor. */
  editorContext: string;
  libraries: LibrarySource[];
  usedEntries: Entry[];
  editorEntries: Entry[];
  questions: QuestionSummary[];
  drafts: QuestionSummary[];
  question?: Question;
  coreEntries: Entry[];
  usage: Record<string, number>;
}
export interface Question {
  id: string;
  number: string;
  prompt: string;
  ke: string;
  notes: string;
  updated: string;
  draft?: true;
  coScope?: string;
  annotations?: TextAnnotation[];
}
export interface TextAnnotation {
  id: string;
  start: number;
  end: number;
  quote: string;
  kind: "concept" | "operator";
  name: string;
  type?: string;
  params?: string[];
  draft?: boolean;
  declaration: string;
}
export type QuestionSummary = Omit<Question, "ke" | "notes" | "annotations">;
export interface CokeCase {
  id: string;
  title: string;
  naturalLanguage: string;
  co: string;
  ke: string;
  notes: string;
  confirmed: boolean;
  updated: string;
}
export interface LibraryEdit {
  key?: string;
  entry: Entry | null;
}
export const entryKey = (entry: Entry) =>
  `${entry.kind}:${entry.name}${entry.kind === "operator" ? `(${entry.params.map((p) => p.type).join(",")})` : ""}`;
export const displayType = (
  type: string,
  syntax = { set: "set", open: "(", close: ")" },
) =>
  type
    .replace(/set\{/g, syntax.set + syntax.open)
    .replaceAll("}", syntax.close);
