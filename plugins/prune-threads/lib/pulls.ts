import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { GitInspection } from "./contract.js";
import type { PruneGroup, PruneThread } from "./policy.js";

export const PR_BOARD_PLUGIN_ID = "pr-board";
const METADATA_BATCH = 200;

const pullMetadataSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
});

const boardSchema = z.object({
  cards: z.array(
    z.object({ repo: z.string(), number: z.number(), headRefName: z.string() }),
  ),
  errors: z.array(z.unknown()),
});

export interface BranchRef {
  repo: string | null;
  branch: string;
}

export interface OpenPulls {
  pulls: ReadonlySet<string>;
  reposByBranch: ReadonlyMap<string, ReadonlySet<string>>;
}

export function pullKey(pull: { repo: string; number: number }) {
  return `${pull.repo.toLowerCase()}#${pull.number}`;
}

export function repoFromRemoteUrl(url: string | null): string | null {
  const match =
    url === null
      ? null
      : /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match === null ? null : `${match[1]}/${match[2]}`.toLowerCase();
}

export function branchesOf(inspection: GitInspection | null): BranchRef[] {
  if (inspection?.kind !== "git") return [];
  return inspection.branches.map(({ remoteUrl, branch }) => ({
    repo: repoFromRemoteUrl(remoteUrl),
    branch,
  }));
}

export function openPullsFrom(
  cards: ReadonlyArray<{ repo: string; number: number; headRefName: string }>,
): OpenPulls {
  const reposByBranch = new Map<string, Set<string>>();
  for (const card of cards) {
    const repos = reposByBranch.get(card.headRefName) ?? new Set<string>();
    repos.add(card.repo.toLowerCase());
    reposByBranch.set(card.headRefName, repos);
  }
  return { pulls: new Set(cards.map(pullKey)), reposByBranch };
}

function onOpenBranch(refs: readonly BranchRef[], open: OpenPulls) {
  return refs.some(({ repo, branch }) => {
    const repos = open.reposByBranch.get(branch);
    return repos !== undefined && (repo === null || repos.has(repo));
  });
}

export type ReadPullThreads = (
  threadIds: readonly string[],
) => Promise<Map<string, string>>;
export type ReadBoard = () => Promise<OpenPulls | null>;

export async function filterClosedPullGroups(
  groups: readonly PruneGroup[],
  branchesFor: (thread: PruneThread) => readonly BranchRef[],
  readPullThreads: ReadPullThreads,
  readBoard: ReadBoard,
): Promise<PruneGroup[]> {
  const threads = groups.flatMap((group) => group.members);
  if (threads.length === 0) return [];
  const pullByThread = await readPullThreads(
    threads.map((thread) => thread.id),
  );
  const needsBoard = threads.some(
    (thread) => pullByThread.has(thread.id) || branchesFor(thread).length > 0,
  );
  if (!needsBoard) return [...groups];
  const open = await readBoard();
  return groups.filter((group) =>
    group.members.every((thread) => {
      const pull = pullByThread.get(thread.id);
      const refs = branchesFor(thread);
      if (pull === undefined && refs.length === 0) return true;
      if (open === null) return false;
      return (
        (pull === undefined || !open.pulls.has(pull)) &&
        !onOpenBranch(refs, open)
      );
    }),
  );
}

export function createPullReaders(bb: BbPluginApi) {
  const readPullThreads: ReadPullThreads = async (threadIds) => {
    const pulls = new Map<string, string>();
    for (let start = 0; start < threadIds.length; start += METADATA_BATCH) {
      const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({
        pluginId: PR_BOARD_PLUGIN_ID,
        threadIds: threadIds.slice(start, start + METADATA_BATCH),
      });
      for (const { threadId, metadata } of threads) {
        const pull = pullMetadataSchema.safeParse(metadata);
        if (pull.success) pulls.set(threadId, pullKey(pull.data));
      }
    }
    return pulls;
  };

  const readBoard: ReadBoard = async () => {
    try {
      const board = await bb.sdk.plugins.callRpc({
        pluginId: PR_BOARD_PLUGIN_ID,
        method: "board",
        input: { refresh: false },
        outputSchema: boardSchema,
      });
      if (board.errors.length > 0) return null;
      return openPullsFrom(board.cards);
    } catch (error) {
      bb.log.warn(
        `could not read the PR board, keeping PR and git threads: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  return { readPullThreads, readBoard };
}
