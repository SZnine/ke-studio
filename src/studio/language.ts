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
  files: Record<string, string>;
  error?: string;
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
  questions: QuestionSummary[];
  drafts: QuestionSummary[];
  proposals: Proposal[];
  question?: Question;
  coreEntries: Entry[];
  model: {
    baseUrl: string;
    model: string;
    hasKey: boolean;
    maxTokens?: number;
  };
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
}
export interface ProposalItem {
  id: string;
  title: string;
  reason: string;
  recommended: boolean;
  before: string;
  after: string;
  library?: string;
  edit?: LibraryEdit;
  source?: SourceEdit;
}
export interface Proposal {
  id: string;
  domain: string;
  reason: string;
  created: string;
  items: ProposalItem[];
}
export type QuestionSummary = Omit<Question, "ke" | "notes">;
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
export interface ChatStep {
  id: string;
  kind: "model" | "tool";
  name: string;
  status: "receiving" | "running" | "complete" | "error" | "stopped";
  started: number;
  duration?: number;
  explanation?: string;
  reasoning?: string;
  input?: string;
  output?: string;
}
export interface LibraryEdit {
  key?: string;
  entry: Entry | null;
}
export interface SourceEdit {
  file: string;
  before: string;
  after: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: ChatStep[];
  question?: { id: string; number: string; draft?: true };
  state?: "running" | "complete" | "stopped" | "error";
  context?: ChatContext;
  changes?: { id: string; file: string; reason: string }[];
}
export type ChatEvent =
  | { type: "step"; step: ChatStep }
  | { type: "status"; text: string }
  | { type: "text"; text: string; stepId: string }
  | { type: "complete"; message: ChatMessage; workspace: Workspace }
  | { type: "error"; error: string };
export interface ChatContext {
  tab?: string;
  file?: string;
  languageDraft?: boolean;
  questionId?: string;
  draftId?: string;
  intent?: "co-update" | "resolve-conflicts";
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
