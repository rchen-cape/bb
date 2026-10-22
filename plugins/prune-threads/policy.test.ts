import { describe, expect, it } from "vitest";
import { MIN_IDLE_MS, selectGroups, type PruneThread } from "./lib/policy.js";

const NOW = 10 * MIN_IDLE_MS;
const OLD = NOW - MIN_IDLE_MS - 1;

function thread(id: string, overrides: Partial<PruneThread> = {}): PruneThread {
  return {
    id,
    projectId: "proj",
    environmentBranchName: null,
    title: id,
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: OLD,
    latestAttentionAt: OLD,
    statusChangedAt: OLD,
    awaitingUserReply: false,
    createdAt: OLD,
    hasPendingInteraction: false,
    queuedWork: "none",
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    environmentId: null,
    environmentHostId: null,
    environmentPath: null,
    ...overrides,
  };
}

const rootIds = (threads: PruneThread[]) =>
  selectGroups(threads, NOW).map((group) => group.rootId);

describe("selectGroups", () => {
  it("selects a read, idle thread with no activity for over 24 hours", () => {
    expect(rootIds([thread("a")])).toEqual(["a"]);
  });

  it.each<[string, Partial<PruneThread>]>([
    ["unread", { lastReadAt: OLD - 1 }],
    ["never read", { lastReadAt: null }],
    ["recently created", { createdAt: NOW - 1000 }],
    ["recent status change", { statusChangedAt: NOW - 1000 }],
    ["pending interaction", { hasPendingInteraction: true }],
    ["awaiting a reply", { awaitingUserReply: true }],
    ["queued work", { queuedWork: "waiting" }],
    ["failed queued work", { queuedWork: "failed" }],
    ["running", { status: "active" }],
    ["errored", { status: "error" }],
    ["pinned", { pinnedAt: OLD }],
    ["archived", { archivedAt: OLD }],
    [
      "a background agent",
      {
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      },
    ],
  ])("keeps a thread that is %s", (_, overrides) => {
    expect(rootIds([thread("a", overrides)])).toEqual([]);
  });

  it("keeps a parent when a child still needs attention", () => {
    expect(
      rootIds([
        thread("parent"),
        thread("child", {
          parentThreadId: "parent",
          hasPendingInteraction: true,
        }),
      ]),
    ).toEqual([]);
  });

  it("deletes the parent and its separately owned children together", () => {
    const [group] = selectGroups(
      [
        thread("parent"),
        thread("child", { parentThreadId: "parent" }),
        thread("owned", {
          parentThreadId: "parent",
          lifecycleOwnerThreadId: "parent",
        }),
      ],
      NOW,
    );
    expect(group?.rootId).toBe("parent");
    expect(group?.members.map((member) => member.id).sort()).toEqual([
      "child",
      "owned",
      "parent",
    ]);
    expect(group?.deleteIds.sort()).toEqual(["child", "parent"]);
  });

  it("keeps a source thread's hidden side thread in the same group", () => {
    expect(
      rootIds([
        thread("source"),
        thread("side", {
          visibility: "hidden",
          sourceThreadId: "source",
          lastReadAt: null,
        }),
      ]),
    ).toEqual([]);
  });

  it("treats a child of a deleted parent as its own root", () => {
    expect(
      rootIds([
        thread("parent", { deletedAt: OLD }),
        thread("child", { parentThreadId: "parent" }),
      ]),
    ).toEqual(["child"]);
  });
});
