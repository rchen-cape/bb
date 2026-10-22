import { describe, expect, it, vi } from "vitest";
import type { PruneGroup, PruneThread } from "./lib/policy.js";
import {
  filterClosedPullGroups,
  openPullsFrom,
  repoFromRemoteUrl,
  type BranchRef,
} from "./lib/pulls.js";

function group(rootId: string, memberIds: string[] = [rootId]): PruneGroup {
  return {
    rootId,
    members: memberIds.map((id) => ({ id }) as PruneThread),
    deleteIds: [rootId],
  };
}

const pulls = new Map([
  ["review", "acme/api#1"],
  ["explain", "acme/api#2"],
  ["address", "acme/web#3"],
]);
const readPulls = async (ids: readonly string[]) =>
  new Map([...pulls].filter(([id]) => ids.includes(id)));

const branches: Record<string, BranchRef[]> = {
  "on-pr-branch": [{ repo: "acme/api", branch: "feature/login" }],
  "tracks-pr-branch": [
    { repo: "acme/api", branch: "bb/fix-comments-thr_1" },
    { repo: "acme/api", branch: "feature/login" },
  ],
  "same-branch-other-repo": [{ repo: "acme/web", branch: "feature/login" }],
  "on-main": [{ repo: "acme/api", branch: "main" }],
};
const branchesFor = (thread: PruneThread) => branches[thread.id] ?? [];

const board = openPullsFrom([
  { repo: "acme/api", number: 1, headRefName: "feature/login" },
  { repo: "Acme/Web", number: 3, headRefName: "fix/nav" },
]);

const rootIds = (groups: PruneGroup[]) => groups.map((entry) => entry.rootId);

describe("filterClosedPullGroups", () => {
  it("keeps PR Board threads whose PR is still on the board", async () => {
    const result = await filterClosedPullGroups(
      [group("review"), group("explain"), group("address"), group("plain")],
      branchesFor,
      readPulls,
      async () => board,
    );
    expect(rootIds(result)).toEqual(["explain", "plain"]);
  });

  it("keeps threads you started on, or tracking, an open PR's branch", async () => {
    const result = await filterClosedPullGroups(
      [
        group("on-pr-branch"),
        group("tracks-pr-branch"),
        group("same-branch-other-repo"),
        group("on-main"),
      ],
      branchesFor,
      readPulls,
      async () => board,
    );
    expect(rootIds(result)).toEqual(["same-branch-other-repo", "on-main"]);
  });

  it("keeps a group when one of its child threads is an open PR thread", async () => {
    const result = await filterClosedPullGroups(
      [group("plain", ["plain", "review"])],
      branchesFor,
      readPulls,
      async () => board,
    );
    expect(result).toEqual([]);
  });

  it("keeps PR and git threads when the board cannot be read", async () => {
    const result = await filterClosedPullGroups(
      [group("review"), group("on-main"), group("plain")],
      branchesFor,
      readPulls,
      async () => null,
    );
    expect(rootIds(result)).toEqual(["plain"]);
  });

  it("skips reading the board when no candidate has a PR or a branch", async () => {
    const readBoard = vi.fn(async () => board);
    const result = await filterClosedPullGroups(
      [group("plain")],
      branchesFor,
      readPulls,
      readBoard,
    );
    expect(rootIds(result)).toEqual(["plain"]);
    expect(readBoard).not.toHaveBeenCalled();
  });
});

describe("repoFromRemoteUrl", () => {
  it.each([
    ["git@github.com:Acme/API.git", "acme/api"],
    ["https://github.com/acme/api", "acme/api"],
    ["https://github.com/acme/api.git/", "acme/api"],
    ["ssh://git@github.com/acme/api.git", "acme/api"],
    ["/tmp/remote.git", null],
    [null, null],
  ])("reads %s as %s", (url, repo) => {
    expect(repoFromRemoteUrl(url)).toBe(repo);
  });
});
