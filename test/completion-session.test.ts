import { expect, it } from "vitest";
import { CompletionSession } from "../web/studio/completion-session";
it("keeps Esc dismissed through newline, Tab and cursor requests, ignoring late responses", () => {
  const session = new CompletionSession(),
    request = session.revision;
  session.dismiss();
  expect(session.accepts(request)).toBe(false);
  for (const input of ["\n", "\t", " ", ""])
    expect(session.typed(input)).toBe(false);
  expect(session.dismissed).toBe(true);
  expect(session.typed("p")).toBe(true);
  expect(session.accepts(request)).toBe(false);
  expect(session.accepts(session.revision)).toBe(true);
  session.dismiss();
  session.resume();
  expect(session.accepts(session.revision)).toBe(true);
});
