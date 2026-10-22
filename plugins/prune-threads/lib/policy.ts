import type { BbPluginApi } from "@get-bb/plugin-sdk";

type ThreadListEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
export type PruneThread = Pick<
  ThreadListEntry,
  | "id"
  | "projectId"
  | "environmentBranchName"
  | "title"
  | "titleFallback"
  | "status"
  | "parentThreadId"
  | "lifecycleOwnerThreadId"
  | "sourceThreadId"
  | "visibility"
  | "archivedAt"
  | "pinnedAt"
  | "deletedAt"
  | "lastReadAt"
  | "latestAttentionAt"
  | "statusChangedAt"
  | "awaitingUserReply"
  | "createdAt"
  | "hasPendingInteraction"
  | "queuedWork"
  | "activity"
  | "environmentId"
  | "environmentHostId"
  | "environmentPath"
>;

export interface PruneGroup {
  rootId: string;
  members: PruneThread[];
  deleteIds: string[];
}

export const MIN_IDLE_MS = 24 * 60 * 60 * 1000;

export function lastActivityAt(thread: PruneThread) {
  return Math.max(
    thread.createdAt,
    thread.statusChangedAt,
    thread.latestAttentionAt,
  );
}

export function isPrunable(thread: PruneThread, now: number) {
  return (
    thread.status === "idle" &&
    thread.pinnedAt === null &&
    !thread.hasPendingInteraction &&
    !thread.awaitingUserReply &&
    thread.queuedWork === "none" &&
    Object.values(thread.activity).every((count) => count === 0) &&
    (thread.lastReadAt ?? 0) >= thread.latestAttentionAt &&
    lastActivityAt(thread) <= now - MIN_IDLE_MS
  );
}

export function selectGroups(
  threads: readonly PruneThread[],
  now: number,
): PruneGroup[] {
  const live = threads.filter(
    (thread) => thread.deletedAt === null && thread.archivedAt === null,
  );
  const byId = new Map(live.map((thread) => [thread.id, thread]));
  const children = new Map<string, PruneThread[]>();
  const owners = (thread: PruneThread) =>
    [
      thread.lifecycleOwnerThreadId,
      thread.parentThreadId,
      thread.visibility === "hidden" ? thread.sourceThreadId : null,
    ].filter((id): id is string => id !== null && byId.has(id));
  for (const thread of live) {
    for (const owner of owners(thread)) {
      const list = children.get(owner) ?? [];
      list.push(thread);
      children.set(owner, list);
    }
  }
  const groups: PruneGroup[] = [];
  for (const root of live) {
    if (owners(root).length > 0) continue;
    const members: PruneThread[] = [];
    const seen = new Set<string>();
    const pending = [root];
    while (pending.length > 0) {
      const thread = pending.pop()!;
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      members.push(thread);
      pending.push(...(children.get(thread.id) ?? []));
    }
    if (!members.every((thread) => isPrunable(thread, now))) continue;
    groups.push({
      rootId: root.id,
      members,
      deleteIds: members
        .filter(
          (thread) =>
            thread.lifecycleOwnerThreadId === null ||
            !seen.has(thread.lifecycleOwnerThreadId),
        )
        .map((thread) => thread.id),
    });
  }
  return groups;
}

export function threadLabel(thread: PruneThread) {
  return thread.title ?? thread.titleFallback ?? thread.id;
}
