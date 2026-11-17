import type { Change } from "../../src/studio/store";
export function changeFiles(change: Change) {
  if (/^(questions|drafts)\//.test(change.file)) {
    const before = change.before ? JSON.parse(change.before) : {};
    const after = change.after ? JSON.parse(change.after) : {};
    return ["number", "prompt", "ke", "notes"]
      .filter((key) => before[key] !== after[key])
      .map((key) => ({
        file: `${after.number || before.number} / ${{ number: "题号", prompt: "题干", ke: "KE", notes: "备注" }[key]}`,
        before: before[key] || "",
        after: after[key] || "",
      }));
  }
  if (change.file !== "language" && change.file !== "update")
    return [{ ...change }];
  const unpack = (value: string): Record<string, string> => {
    const data = JSON.parse(value);
    return change.file === "language"
      ? data
      : {
          ...Object.fromEntries(
            Object.entries(data.language).map(([k, v]) => [
              "language/" + k,
              String(v),
            ]),
          ),
          ...Object.fromEntries(
            Object.entries(data.libraries).map(([k, v]) => [
              "libraries/" + k + ".keh",
              String(v),
            ]),
          ),
        };
  };
  const before = unpack(change.before),
    after = unpack(change.after);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file])
    .map((file) => ({
      file,
      before: before[file] || "",
      after: after[file] || "",
    }));
}
