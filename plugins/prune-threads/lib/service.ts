import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  pruneHostContract,
  type GitInspection,
  type Preview,
  type PruneInput,
  type PruneResult,
  type Status,
} from "./contract.js";
import {
  lastActivityAt,
  selectGroups,
  threadLabel,
  type PruneGroup,
  type PruneThread,
} from "./policy.js";
import {
  branchesOf,
  createPullReaders,
  filterClosedPullGroups,
} from "./pulls.js";

const PAGE_SIZE = 500;

export type InspectGit = (args: {
  hostId: string;
  path: string;
}) => Promise<GitInspection>;

async function readThreads(bb: BbPluginApi) {
  const rows: PruneThread[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await bb.sdk.threads.list({
      archived: false,
      includeHidden: true,
      limit: PAGE_SIZE,
      offset,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function isWorkspaceSafe(inspection: GitInspection) {
  return (
    inspection.kind !== "git" ||
    (!inspection.hasUncommittedChanges && inspection.unpushedCommitCount === 0)
  );
}

export type Workspace =
  | { kind: "none" }
  | { kind: "unknown" }
  | { kind: "checkout"; key: string; hostId: string; path: string };

export function workspaceOf(thread: PruneThread): Workspace {
  if (thread.environmentId === null) return { kind: "none" };
  if (thread.environmentHostId === null || thread.environmentPath === null)
    return { kind: "unknown" };
  return {
    kind: "checkout",
    key: `${thread.environmentHostId}\0${thread.environmentPath}`,
    hostId: thread.environmentHostId,
    path: thread.environmentPath,
  };
}

export type Inspections = ReadonlyMap<string, GitInspection | null>;

export async function inspectWorkspaces(
  groups: readonly PruneGroup[],
  inspectGit: InspectGit,
): Promise<Inspections> {
  const checkouts = new Map<string, { hostId: string; path: string }>();
  for (const group of groups)
    for (const thread of group.members) {
      const workspace = workspaceOf(thread);
      if (workspace.kind === "checkout")
        checkouts.set(workspace.key, workspace);
    }
  const entries = await Promise.all(
    [...checkouts].map(
      async ([key, checkout]) =>
        [key, await inspectGit(checkout).catch(() => null)] as const,
    ),
  );
  return new Map(entries);
}

export function inspectionFor(thread: PruneThread, inspections: Inspections) {
  const workspace = workspaceOf(thread);
  return workspace.kind === "checkout"
    ? (inspections.get(workspace.key) ?? null)
    : null;
}

export function filterPushedGroups(
  groups: readonly PruneGroup[],
  inspections: Inspections,
): PruneGroup[] {
  return groups.filter((group) =>
    group.members.every((thread) => {
      const workspace = workspaceOf(thread);
      if (workspace.kind === "none") return true;
      if (workspace.kind === "unknown") return false;
      const inspection = inspections.get(workspace.key);
      return inspection != null && isWorkspaceSafe(inspection);
    }),
  );
}

export function createService(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: pruneHostContract });
  const inspectGit: InspectGit = ({ hostId, path }) =>
    host.call("inspectGit", { path }, { hostId });

  const pulls = createPullReaders(bb);

  async function groups() {
    const idle = selectGroups(await readThreads(bb), Date.now());
    const inspections = await inspectWorkspaces(idle, inspectGit);
    return filterClosedPullGroups(
      filterPushedGroups(idle, inspections),
      (thread) => branchesOf(inspectionFor(thread, inspections)),
      pulls.readPullThreads,
      pulls.readBoard,
    );
  }

  async function projectNames() {
    try {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return new Map(projects.map((project) => [project.id, project.name]));
    } catch {
      return new Map<string, string>();
    }
  }

  let latest: Status | null = null;
  let checking: Promise<Status> | null = null;

  function record(found: readonly PruneGroup[]): Status {
    latest = {
      threadCount: found.reduce(
        (total, group) => total + group.members.length,
        0,
      ),
      checkedAt: Date.now(),
    };
    return latest;
  }

  function refresh(): Promise<Status> {
    checking ??= groups()
      .then(record)
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  async function status(): Promise<Status> {
    return latest ?? refresh();
  }

  async function preview(): Promise<Preview> {
    const [found, names] = await Promise.all([groups(), projectNames()]);
    record(found);
    return {
      groups: found
        .map((group) => {
          const root = group.members[0]!;
          return {
            rootId: group.rootId,
            title: threadLabel(root),
            projectName: names.get(root.projectId) ?? null,
            branchName: root.environmentBranchName,
            lastActiveAt: Math.max(...group.members.map(lastActivityAt)),
            threadIds: group.members.map((thread) => thread.id),
          };
        })
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    };
  }

  async function prune({ rootIds }: PruneInput): Promise<PruneResult> {
    const selected = new Set(rootIds);
    const deletedThreadIds: string[] = [];
    const failed: PruneResult["failed"] = [];
    for (const group of await groups()) {
      if (!selected.has(group.rootId)) continue;
      for (const threadId of group.deleteIds) {
        try {
          await bb.sdk.threads.delete({
            threadId,
            childThreadsConfirmed: true,
          });
        } catch (error) {
          failed.push({
            threadId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!failed.some((entry) => group.deleteIds.includes(entry.threadId)))
        deletedThreadIds.push(...group.members.map((thread) => thread.id));
    }
    bb.log.info(
      `pruned ${deletedThreadIds.length} threads, ${failed.length} failed`,
    );
    await refresh().catch((error: unknown) =>
      bb.log.warn(`could not recount prunable threads: ${String(error)}`),
    );
    return { deletedThreadIds, failed };
  }

  return { status, refresh, preview, prune };
}
export type Service = ReturnType<typeof createService>;
