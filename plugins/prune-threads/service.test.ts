import { describe, expect, it, vi } from "vitest";
import type { GitInspection } from "./lib/contract.js";
import type { PruneGroup, PruneThread } from "./lib/policy.js";
import { filterPushedGroups, inspectWorkspaces } from "./lib/service.js";

function group(
  rootId: string,
  environments: Array<{ hostId: string | null; path: string | null } | null>,
): PruneGroup {
  const members = environments.map(
    (environment, index) =>
      ({
        id: `${rootId}-${index}`,
        environmentId: environment === null ? null : `env-${rootId}-${index}`,
        environmentHostId: environment?.hostId ?? null,
        environmentPath: environment?.path ?? null,
      }) as PruneThread,
  );
  return { rootId, members, deleteIds: [rootId] };
}

const clean: GitInspection = {
  kind: "git",
  hasUncommittedChanges: false,
  unpushedCommitCount: 0,
  branches: [],
};

async function pushed(
  groups: PruneGroup[],
  inspect: (args: { hostId: string; path: string }) => Promise<GitInspection>,
) {
  return filterPushedGroups(groups, await inspectWorkspaces(groups, inspect));
}

describe("filterPushedGroups", () => {
  it("keeps groups whose workspaces are clean, missing, or not git", async () => {
    const inspections: Record<string, GitInspection> = {
      "/clean": clean,
      "/gone": { kind: "missing" },
      "/plain": { kind: "not_git" },
    };
    const result = await pushed(
      [
        group("a", [
          null,
          { hostId: "h", path: "/clean" },
          { hostId: "h", path: "/gone" },
          { hostId: "h", path: "/plain" },
        ]),
      ],
      async ({ path }) => inspections[path]!,
    );
    expect(result.map((entry) => entry.rootId)).toEqual(["a"]);
  });

  it.each<[string, GitInspection]>([
    ["uncommitted changes", { ...clean, hasUncommittedChanges: true }],
    ["unpushed commits", { ...clean, unpushedCommitCount: 2 }],
  ])("drops a group with %s", async (_, inspection) => {
    const result = await pushed(
      [group("a", [{ hostId: "h", path: "/repo" }])],
      async () => inspection,
    );
    expect(result).toEqual([]);
  });

  it("drops a group when its machine cannot be reached", async () => {
    const result = await pushed(
      [group("a", [{ hostId: "h", path: "/repo" }])],
      async () => {
        throw new Error("host offline");
      },
    );
    expect(result).toEqual([]);
  });

  it("drops a group whose environment has no known location", async () => {
    const inspect = vi.fn(async () => clean);
    const result = await pushed(
      [group("a", [{ hostId: null, path: null }])],
      inspect,
    );
    expect(result).toEqual([]);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("checks each shared workspace once", async () => {
    const inspect = vi.fn(async () => clean);
    await pushed(
      [
        group("a", [{ hostId: "h", path: "/repo" }]),
        group("b", [{ hostId: "h", path: "/repo" }]),
      ],
      inspect,
    );
    expect(inspect).toHaveBeenCalledTimes(1);
  });
});
