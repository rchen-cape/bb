import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  computeIncrement,
  normalizeBreakdown,
  tokenBreakdownSchema,
  usageDialect,
  type StreamBaseline,
} from "./normalize.js";
import type {
  ContextCategoryRecord,
  LedgerStore,
  ThreadMeta,
  ThreadSyncState,
} from "./store.js";

export const INDEXED_EVENT_TYPES = [
  "thread/tokenUsage/updated",
  "turn/started",
  "client/turn/requested",
  "turn/input/accepted",
  "provider/modelFallback",
  "item/backgroundTask/completed",
  "thread/contextWindowUsage/updated",
] as const;

export const EVENT_PAGE_SIZE = 100;
const EVENT_PAGE_SIZES = [EVENT_PAGE_SIZE, 10, 1];
const THREAD_PAGE_SIZE = 500;
export const RECONCILE_INTERVAL_MS = 10 * 60_000;
const ROOT_STREAM = "root";

export const threadRowSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().nullable().optional(),
    titleFallback: z.string().nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    providerId: z.string().min(1),
    parentThreadId: z.string().nullable().optional(),
    sourceThreadId: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    archivedAt: z.number().nullable().optional(),
    deletedAt: z.number().nullable().optional(),
  })
  .loose();

export interface ThreadInput {
  id: string;
  title: string | null;
  titleFallback: string | null;
  projectId: string | null;
  providerId: string;
  parentThreadId: string | null;
  sourceThreadId: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt?: number | null;
}

const eventRowSchema = z
  .object({
    id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    createdAt: z.number(),
    type: z.string(),
    scope: z.union([
      z.object({ kind: z.literal("turn"), turnId: z.string().min(1) }).loose(),
      z.object({ kind: z.literal("thread") }).loose(),
    ]),
    data: z.unknown(),
  })
  .loose();
type EventRow = z.output<typeof eventRowSchema>;

const missingThreadErrorSchema = z
  .object({ status: z.literal(404), code: z.literal("thread_not_found") })
  .loose();

const tokenUsageDataSchema = z
  .object({
    providerThreadId: z.string(),
    tokenUsage: z
      .object({ total: tokenBreakdownSchema, last: tokenBreakdownSchema })
      .loose(),
  })
  .loose();
const turnStartedDataSchema = z
  .object({ parentToolCallId: z.string().min(1).nullish() })
  .loose();
const turnRequestedDataSchema = z
  .object({
    requestId: z.string().min(1),
    execution: z.object({ model: z.string().min(1) }).loose(),
  })
  .loose();
const inputAcceptedDataSchema = z
  .object({ clientRequestId: z.string().min(1) })
  .loose();
const modelFallbackDataSchema = z
  .object({ fallbackModel: z.string().min(1) })
  .loose();
const backgroundTaskDataSchema = z
  .object({
    item: z
      .object({
        id: z.string().min(1),
        usage: z
          .object({
            totalTokens: z.number(),
            toolUses: z.number(),
            durationMs: z.number(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose();
const contextUsageDataSchema = z
  .object({
    contextWindowUsage: z
      .object({
        snapshot: z
          .object({
            model: z.string().min(1).nullish(),
            usedTokens: z.number(),
            contextWindowTokens: z.number().nullish(),
            categories: z.array(
              z
                .object({
                  label: z.string(),
                  kind: z.string(),
                  tokens: z.number(),
                  entries: z
                    .array(
                      z
                        .object({ label: z.string(), tokens: z.number() })
                        .loose(),
                    )
                    .optional(),
                })
                .loose(),
            ),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose();

export interface EventRowInput {
  id: string;
  seq: number;
  createdAt: number;
  type: string;
  scope: { kind: "thread" } | { kind: "turn"; turnId: string };
  data: unknown;
}

export interface IndexerSdk {
  threads: {
    list(args: {
      includeHidden: boolean;
      limit: number;
      offset: number;
      signal?: AbortSignal;
    }): Promise<readonly ThreadInput[]>;
    get(args: { threadId: string; signal?: AbortSignal }): Promise<ThreadInput>;
    events: {
      list(args: {
        threadId: string;
        types: typeof INDEXED_EVENT_TYPES;
        afterSeq?: string;
        limit: string;
        order: "asc";
        signal?: AbortSignal;
      }): Promise<readonly EventRowInput[]>;
    };
  };
}

export interface IndexerStatus {
  pendingThreads: number;
  scanning: boolean;
}

export type Indexer = ReturnType<typeof createIndexer>;

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function threadMetaFrom(input: ThreadInput): ThreadMeta {
  const thread = threadRowSchema.parse(input);
  return {
    threadId: thread.id,
    projectId: thread.projectId ?? null,
    providerId: thread.providerId,
    parentThreadId: thread.parentThreadId ?? null,
    sourceThreadId: thread.sourceThreadId ?? null,
    title: thread.title ?? null,
    titleFallback: thread.titleFallback ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived: thread.archivedAt !== null && thread.archivedAt !== undefined,
    deleted: thread.deletedAt !== null && thread.deletedAt !== undefined,
  };
}

function turnIdOf(row: EventRow): string | null {
  return row.scope.kind === "turn" ? row.scope.turnId : null;
}

type ContextSnapshotData = NonNullable<
  z.output<typeof contextUsageDataSchema>["contextWindowUsage"]["snapshot"]
>;

function contextCategories(
  snapshot: ContextSnapshotData,
): ContextCategoryRecord[] {
  return snapshot.categories.map((category) => ({
    label: category.label,
    kind: category.kind,
    tokens: count(category.tokens),
    entries: (category.entries ?? []).map((entry) => ({
      label: entry.label,
      tokens: count(entry.tokens),
    })),
  }));
}

function applyEvent(args: {
  store: LedgerStore;
  thread: ThreadSyncState;
  baselines: Record<string, StreamBaseline>;
  row: EventRow;
}): boolean {
  const { store, thread, baselines, row } = args;
  const turnId = turnIdOf(row);
  switch (row.type) {
    case "turn/started": {
      const data = turnStartedDataSchema.safeParse(row.data);
      if (!data.success || turnId === null) return false;
      store.recordTurn({
        threadId: thread.threadId,
        turnId,
        parentToolCallId: data.data.parentToolCallId ?? null,
        seq: row.seq,
      });
      return false;
    }
    case "client/turn/requested": {
      const data = turnRequestedDataSchema.safeParse(row.data);
      if (!data.success) return false;
      store.recordRequest({
        threadId: thread.threadId,
        requestId: data.data.requestId,
        model: data.data.execution.model,
        seq: row.seq,
      });
      return false;
    }
    case "turn/input/accepted": {
      const data = inputAcceptedDataSchema.safeParse(row.data);
      if (!data.success || turnId === null) return false;
      store.recordInput({
        threadId: thread.threadId,
        requestId: data.data.clientRequestId,
        turnId,
        seq: row.seq,
      });
      return false;
    }
    case "provider/modelFallback": {
      const data = modelFallbackDataSchema.safeParse(row.data);
      if (!data.success) return false;
      store.recordFallback({
        id: row.id,
        threadId: thread.threadId,
        turnId,
        model: data.data.fallbackModel,
        seq: row.seq,
      });
      return false;
    }
    case "item/backgroundTask/completed": {
      if (thread.sourceThreadId !== null && row.createdAt < thread.createdAt) {
        return false;
      }
      const data = backgroundTaskDataSchema.safeParse(row.data);
      const usage = data.success ? data.data.item.usage : undefined;
      if (!data.success || usage === undefined) return false;
      return store.upsertSubagentTask({
        threadId: thread.threadId,
        itemId: data.data.item.id,
        turnId,
        createdAt: row.createdAt,
        totalTokens: count(usage.totalTokens),
        toolUses: count(usage.toolUses),
        durationMs: count(usage.durationMs),
        seq: row.seq,
      });
    }
    case "thread/contextWindowUsage/updated": {
      const data = contextUsageDataSchema.safeParse(row.data);
      const snapshot = data.success
        ? data.data.contextWindowUsage.snapshot
        : undefined;
      if (snapshot === undefined) return false;
      return store.upsertContextSnapshot({
        threadId: thread.threadId,
        seq: row.seq,
        createdAt: row.createdAt,
        model: snapshot.model ?? null,
        usedTokens: count(snapshot.usedTokens),
        windowTokens:
          snapshot.contextWindowTokens === null ||
          snapshot.contextWindowTokens === undefined
            ? null
            : count(snapshot.contextWindowTokens),
        categories: contextCategories(snapshot),
      });
    }
    case "thread/tokenUsage/updated": {
      const data = tokenUsageDataSchema.safeParse(row.data);
      if (!data.success) return false;
      const parentToolCallId =
        turnId === null
          ? null
          : store.turnParentToolCallId(thread.threadId, turnId);
      const stream =
        parentToolCallId === null ? ROOT_STREAM : `sub:${parentToolCallId}`;
      const dialect = usageDialect(thread.providerId);
      const increment = computeIncrement({
        dialect,
        baseline: baselines[stream] ?? null,
        providerThreadId: data.data.providerThreadId,
        firstTotalIsOwn:
          parentToolCallId === null && thread.sourceThreadId === null,
        total: normalizeBreakdown(data.data.tokenUsage.total, dialect),
        last: normalizeBreakdown(data.data.tokenUsage.last, dialect),
      });
      baselines[stream] = increment.baseline;
      const model = store.resolveModel({
        threadId: thread.threadId,
        turnId,
        seq: row.seq,
      });
      const base = {
        threadId: thread.threadId,
        seq: row.seq,
        createdAt: row.createdAt,
        turnId,
        providerId: thread.providerId,
        projectId: thread.projectId,
        model,
        isSubagent: parentToolCallId !== null,
      };
      const insertedLive =
        increment.live !== null &&
        store.insertEntry({
          ...base,
          id: row.id,
          source: "live",
          tokens: increment.live,
        });
      const insertedGap =
        increment.backfill !== null &&
        store.insertEntry({
          ...base,
          id: `${row.id}:gap`,
          source: "backfill",
          tokens: increment.backfill,
        });
      return insertedLive || insertedGap;
    }
    default:
      return false;
  }
}

export function createIndexer(deps: {
  sdk: () => IndexerSdk;
  store: LedgerStore;
  log: PluginLogger;
  onChange: () => void;
  now: () => number;
}) {
  const urgent = new Set<string>();
  const background = new Set<string>();
  let inFlight: string | null = null;
  let reconciling = false;
  let reconcileRequested = false;
  let wakeUp: (() => void) | null = null;

  function wake(): void {
    const resolve = wakeUp;
    wakeUp = null;
    resolve?.();
  }

  function enqueue(threadId: string, priority: boolean): void {
    if (priority) {
      background.delete(threadId);
      urgent.add(threadId);
    } else if (!urgent.has(threadId)) {
      background.add(threadId);
    }
    wake();
  }

  function takeNext(): string | null {
    for (const queue of [urgent, background]) {
      const next = queue.values().next();
      if (!next.done) {
        queue.delete(next.value);
        return next.value;
      }
    }
    return null;
  }

  function waitForWork(signal: AbortSignal, durationMs: number) {
    if (
      signal.aborted ||
      urgent.size > 0 ||
      background.size > 0 ||
      reconcileRequested
    ) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        if (wakeUp === finish) wakeUp = null;
        resolve();
      };
      const timer = setTimeout(finish, durationMs);
      signal.addEventListener("abort", finish, { once: true });
      wakeUp = finish;
    });
  }

  async function syncThread(
    threadId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const thread = deps.store.thread(threadId);
    if (thread === null || thread.deleted) return false;
    const cursors = { ...thread.cursors };
    const baselines = { ...thread.baselines };
    let changed = false;
    let pageSizes = EVENT_PAGE_SIZES;
    for (;;) {
      signal.throwIfAborted();
      const known = INDEXED_EVENT_TYPES.map((type) => cursors[type]);
      const afterSeq = known.every((cursor) => cursor !== undefined)
        ? Math.min(...known.filter((cursor) => cursor !== undefined))
        : null;
      const pageSize = pageSizes[0] ?? 1;
      let page: readonly EventRowInput[];
      try {
        page = await deps.sdk().threads.events.list({
          threadId,
          types: INDEXED_EVENT_TYPES,
          ...(afterSeq === null ? {} : { afterSeq: String(afterSeq) }),
          limit: String(pageSize),
          order: "asc",
          signal,
        });
      } catch (error) {
        if (signal.aborted || pageSizes.length <= 1) throw error;
        pageSizes = pageSizes.slice(1);
        continue;
      }
      const rows = page.map((row) => eventRowSchema.parse(row));
      if (rows.length === 0) break;
      const pageChanged = deps.store.transaction(() => {
        let touched = false;
        for (const row of rows) {
          const cursor = cursors[row.type];
          if (cursor !== undefined && row.seq <= cursor) continue;
          if (applyEvent({ store: deps.store, thread, baselines, row })) {
            touched = true;
          }
        }
        const highest = Math.max(...rows.map((row) => row.seq));
        for (const type of INDEXED_EVENT_TYPES) {
          cursors[type] = Math.max(cursors[type] ?? highest, highest);
        }
        deps.store.saveSyncProgress({ threadId, cursors, baselines });
        return touched;
      });
      changed = changed || pageChanged;
      if (rows.length < pageSize) break;
    }
    deps.store.markSynced({
      threadId,
      syncedUpdatedAt: thread.updatedAt,
      now: deps.now(),
    });
    return changed;
  }

  function markDeleted(threadId: string): void {
    urgent.delete(threadId);
    background.delete(threadId);
    deps.store.markDeleted(threadId);
    deps.onChange();
  }

  async function confirmMissing(
    threadId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let row: ThreadInput;
    try {
      row = await deps.sdk().threads.get({ threadId, signal });
    } catch (error) {
      if (missingThreadErrorSchema.safeParse(error).success) {
        markDeleted(threadId);
        return;
      }
      if (signal.aborted) throw error;
      deps.log.warn(
        `AI Hub could not check whether thread ${threadId} still exists: ${errorText(error)}`,
      );
      return;
    }
    const meta = threadMetaFrom(row);
    if (deps.store.upsertThread(meta).needsSync) enqueue(meta.threadId, false);
  }

  async function reconcile(signal: AbortSignal): Promise<void> {
    reconciling = true;
    try {
      const seen = new Set<string>();
      for (let offset = 0; ; offset += THREAD_PAGE_SIZE) {
        signal.throwIfAborted();
        const page = await deps.sdk().threads.list({
          includeHidden: true,
          limit: THREAD_PAGE_SIZE,
          offset,
          signal,
        });
        deps.store.transaction(() => {
          for (const row of page) {
            const meta = threadMetaFrom(row);
            seen.add(meta.threadId);
            if (deps.store.upsertThread(meta).needsSync) {
              enqueue(meta.threadId, false);
            }
          }
        });
        if (page.length < THREAD_PAGE_SIZE) break;
      }
      for (const threadId of deps.store.liveThreadIds()) {
        if (seen.has(threadId)) continue;
        signal.throwIfAborted();
        await confirmMissing(threadId, signal);
      }
    } finally {
      reconciling = false;
    }
  }

  async function drain(signal: AbortSignal): Promise<void> {
    for (
      let threadId = takeNext();
      threadId !== null && !signal.aborted;
      threadId = takeNext()
    ) {
      inFlight = threadId;
      try {
        if (await syncThread(threadId, signal)) deps.onChange();
      } catch (error) {
        if (!signal.aborted) {
          deps.log.warn(
            `AI Hub could not index thread ${threadId}: ${errorText(error)}`,
          );
        }
      } finally {
        inFlight = null;
      }
    }
  }

  return {
    noteThread(input: ThreadInput, options: { sync: boolean }): void {
      try {
        const meta = threadMetaFrom(input);
        const { needsSync } = deps.store.upsertThread(meta);
        if (options.sync || needsSync) enqueue(meta.threadId, options.sync);
      } catch (error) {
        deps.log.warn(`AI Hub could not record a thread: ${errorText(error)}`);
      }
    },
    markDeleted,
    rescan(): number {
      const threadIds = deps.store.liveThreadIds();
      for (const threadId of threadIds) enqueue(threadId, false);
      reconcileRequested = true;
      wake();
      return threadIds.length;
    },
    status(): IndexerStatus {
      const pendingThreads =
        urgent.size + background.size + (inFlight === null ? 0 : 1);
      return {
        pendingThreads,
        scanning: reconciling || pendingThreads > 0,
      };
    },
    syncThread,
    reconcile,
    drain,
    async run(signal: AbortSignal): Promise<void> {
      deps.store.ensureTrackingSince(deps.now());
      let nextReconcileAt = 0;
      while (!signal.aborted) {
        if (reconcileRequested || deps.now() >= nextReconcileAt) {
          reconcileRequested = false;
          try {
            await reconcile(signal);
          } catch (error) {
            if (!signal.aborted) {
              deps.log.warn(
                `AI Hub could not list threads to index: ${errorText(error)}`,
              );
            }
          }
          nextReconcileAt = deps.now() + RECONCILE_INTERVAL_MS;
        }
        await drain(signal);
        await waitForWork(signal, Math.max(0, nextReconcileAt - deps.now()));
      }
    },
  };
}
