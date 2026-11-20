import { expect, it, vi } from "vitest";
import type { Workspace } from "../src/studio/language";
import { createWorkspaceLoader } from "../web/studio/api";

it("runs a newer CO refresh even when the previous question read is pending", async () => {
  let selected = "geometry|first||default";
  let finishFirst!: (state: Workspace) => void;
  const current = { editorContext: "with-new-co" } as Workspace;
  const read = vi
    .fn<(url: string) => Promise<Workspace>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(current);
  const loaded = vi.fn();
  const failed = vi.fn();
  const refresh = createWorkspaceLoader({
    selected: () => selected,
    read,
    loaded,
    failed,
  });

  const first = refresh();
  selected = "geometry|second||default";
  await refresh();
  finishFirst({ editorContext: "stale" } as Workspace);
  await first;

  expect(read.mock.calls.map(([url]) => url)).toEqual([
    "/api/state?domain=geometry&question=first",
    "/api/state?domain=geometry&question=second",
  ]);
  expect(loaded).toHaveBeenCalledExactlyOnceWith(current);
  expect(failed).not.toHaveBeenCalled();
});
