import type Database from "better-sqlite3";
import { z } from "zod";
import type { EntrySource } from "../contract.js";
import {
  streamBaselineSchema,
  type LedgerTokens,
  type StreamBaseline,
} from "./normalize.js";

export type Db = Database.Database;

export const migrations = [
  `CREATE TABLE IF NOT EXISTS sync_threads (
     thread_id TEXT PRIMARY KEY,
     project_id TEXT,
     provider_id TEXT NOT NULL,
     parent_thread_id TEXT,
     source_thread_id TEXT,
     title TEXT,
     title_fallback TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     deleted INTEGER NOT NULL DEFAULT 0,
     cursors TEXT NOT NULL DEFAULT '{}',
     baselines TEXT NOT NULL DEFAULT '{}',
     synced_updated_at INTEGER,
     last_synced_at INTEGER
   );
   CREATE TABLE IF NOT EXISTS usage_entries (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     turn_id TEXT,
     provider_id TEXT NOT NULL,
     project_id TEXT,
     model TEXT,
     is_subagent INTEGER NOT NULL,
     source TEXT NOT NULL,
     input_tokens INTEGER NOT NULL,
     cache_read_tokens INTEGER NOT NULL,
     cache_write_tokens INTEGER NOT NULL,
     output_tokens INTEGER NOT NULL,
     reasoning_tokens INTEGER NOT NULL,
     total_tokens INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS usage_entries_created_idx
     ON usage_entries(created_at);
   CREATE INDEX IF NOT EXISTS usage_entries_thread_idx
     ON usage_entries(thread_id, seq);
   CREATE TABLE IF NOT EXISTS thread_turns (
     thread_id TEXT NOT NULL,
     turn_id TEXT NOT NULL,
     parent_tool_call_id TEXT,
     seq INTEGER NOT NULL,
     PRIMARY KEY (thread_id, turn_id)
   );
   CREATE INDEX IF NOT EXISTS thread_turns_seq_idx
     ON thread_turns(thread_id, seq);
   CREATE TABLE IF NOT EXISTS turn_requests (
     thread_id TEXT NOT NULL,
     request_id TEXT NOT NULL,
     model TEXT NOT NULL,
     seq INTEGER NOT NULL,
     PRIMARY KEY (thread_id, request_id)
   );
   CREATE INDEX IF NOT EXISTS turn_requests_seq_idx
     ON turn_requests(thread_id, seq);
   CREATE TABLE IF NOT EXISTS turn_inputs (
     thread_id TEXT NOT NULL,
     request_id TEXT NOT NULL,
     turn_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     PRIMARY KEY (thread_id, request_id)
   );
   CREATE INDEX IF NOT EXISTS turn_inputs_turn_idx
     ON turn_inputs(thread_id, turn_id, seq);
   CREATE TABLE IF NOT EXISTS model_fallbacks (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     turn_id TEXT,
     fallback_model TEXT NOT NULL,
     seq INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS model_fallbacks_thread_idx
     ON model_fallbacks(thread_id, seq);
   CREATE TABLE IF NOT EXISTS subagent_tasks (
     thread_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     turn_id TEXT,
     created_at INTEGER NOT NULL,
     total_tokens INTEGER NOT NULL,
     tool_uses INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     seq INTEGER NOT NULL,
     PRIMARY KEY (thread_id, item_id)
   );
   CREATE INDEX IF NOT EXISTS subagent_tasks_created_idx
     ON subagent_tasks(created_at);
   CREATE TABLE IF NOT EXISTS context_snapshots (
     thread_id TEXT PRIMARY KEY,
     seq INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     model TEXT,
     used_tokens INTEGER NOT NULL,
     window_tokens INTEGER,
     categories TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS ledger_meta (
     key TEXT PRIMARY KEY,
     value INTEGER NOT NULL
   );`,
  `ALTER TABLE usage_entries
     ADD COLUMN first_of_turn INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX IF NOT EXISTS usage_entries_turn_idx
     ON usage_entries(thread_id, turn_id, created_at);
   CREATE INDEX IF NOT EXISTS usage_entries_thread_created_idx
     ON usage_entries(thread_id, created_at);
   UPDATE usage_entries SET first_of_turn = 1
   WHERE id IN (
     SELECT id FROM (
       SELECT id, ROW_NUMBER() OVER (
         PARTITION BY thread_id, COALESCE(turn_id, id)
         ORDER BY created_at, id
       ) AS position
       FROM usage_entries WHERE source = 'live'
     ) WHERE position = 1
   );`,
];

export interface ThreadMeta {
  threadId: string;
  projectId: string | null;
  providerId: string;
  parentThreadId: string | null;
  sourceThreadId: string | null;
  title: string | null;
  titleFallback: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  deleted: boolean;
}

export interface ThreadSyncState extends ThreadMeta {
  cursors: Record<string, number>;
  baselines: Record<string, StreamBaseline>;
  syncedUpdatedAt: number | null;
  lastSyncedAt: number | null;
}

export interface LedgerEntry {
  id: string;
  threadId: string;
  seq: number;
  createdAt: number;
  turnId: string | null;
  providerId: string;
  projectId: string | null;
  model: string | null;
  isSubagent: boolean;
  source: EntrySource;
  tokens: LedgerTokens;
}

export interface SubagentTaskRecord {
  threadId: string;
  itemId: string;
  turnId: string | null;
  createdAt: number;
  totalTokens: number;
  toolUses: number;
  durationMs: number;
  seq: number;
}

export interface ContextCategoryRecord {
  label: string;
  kind: string;
  tokens: number;
  entries: { label: string; tokens: number }[];
}

export interface ContextSnapshotRecord {
  threadId: string;
  seq: number;
  createdAt: number;
  model: string | null;
  usedTokens: number;
  windowTokens: number | null;
  categories: ContextCategoryRecord[];
}

const cursorsSchema = z.record(z.string(), z.number().int());
const baselinesSchema = z.record(z.string(), streamBaselineSchema);

const META_TRACKING_SINCE = "trackingSinceMs";
const META_LAST_INDEXED = "lastIndexedAtMs";

interface RawThreadRow {
  threadId: string;
  projectId: string | null;
  providerId: string;
  parentThreadId: string | null;
  sourceThreadId: string | null;
  title: string | null;
  titleFallback: string | null;
  createdAt: number;
  updatedAt: number;
  archived: number;
  deleted: number;
  cursors: string;
  baselines: string;
  syncedUpdatedAt: number | null;
  lastSyncedAt: number | null;
}

const THREAD_COLUMNS = `thread_id AS threadId, project_id AS projectId,
  provider_id AS providerId, parent_thread_id AS parentThreadId,
  source_thread_id AS sourceThreadId, title, title_fallback AS titleFallback,
  created_at AS createdAt, updated_at AS updatedAt, archived, deleted,
  cursors, baselines, synced_updated_at AS syncedUpdatedAt,
  last_synced_at AS lastSyncedAt`;

function parseJsonColumn<T>(schema: z.ZodType<T>, text: string): T {
  return schema.parse(JSON.parse(text));
}

function decodeThread(raw: RawThreadRow): ThreadSyncState {
  return {
    threadId: raw.threadId,
    projectId: raw.projectId,
    providerId: raw.providerId,
    parentThreadId: raw.parentThreadId,
    sourceThreadId: raw.sourceThreadId,
    title: raw.title,
    titleFallback: raw.titleFallback,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    archived: raw.archived === 1,
    deleted: raw.deleted === 1,
    cursors: parseJsonColumn(cursorsSchema, raw.cursors),
    baselines: parseJsonColumn(baselinesSchema, raw.baselines),
    syncedUpdatedAt: raw.syncedUpdatedAt,
    lastSyncedAt: raw.lastSyncedAt,
  };
}

export type LedgerStore = ReturnType<typeof createLedgerStore>;

export function createLedgerStore(db: Db) {
  const getMeta = db.prepare<[string], { value: number }>(
    "SELECT value FROM ledger_meta WHERE key = ?",
  );
  const setMeta = db.prepare<[string, number]>(
    `INSERT INTO ledger_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const insertMetaIfMissing = db.prepare<[string, number]>(
    "INSERT OR IGNORE INTO ledger_meta (key, value) VALUES (?, ?)",
  );
  const upsertThread = db.prepare<
    {
      threadId: string;
      projectId: string | null;
      providerId: string;
      parentThreadId: string | null;
      sourceThreadId: string | null;
      title: string | null;
      titleFallback: string | null;
      createdAt: number;
      updatedAt: number;
      archived: number;
      deleted: number;
    },
    { syncedUpdatedAt: number | null }
  >(
    `INSERT INTO sync_threads (
       thread_id, project_id, provider_id, parent_thread_id, source_thread_id,
       title, title_fallback, created_at, updated_at, archived, deleted
     ) VALUES (
       @threadId, @projectId, @providerId, @parentThreadId, @sourceThreadId,
       @title, @titleFallback, @createdAt, @updatedAt, @archived, @deleted
     )
     ON CONFLICT(thread_id) DO UPDATE SET
       project_id = excluded.project_id,
       provider_id = excluded.provider_id,
       parent_thread_id = excluded.parent_thread_id,
       source_thread_id = excluded.source_thread_id,
       title = excluded.title,
       title_fallback = excluded.title_fallback,
       created_at = excluded.created_at,
       updated_at = MAX(sync_threads.updated_at, excluded.updated_at),
       archived = excluded.archived,
       deleted = excluded.deleted
     RETURNING synced_updated_at AS syncedUpdatedAt`,
  );
  const getThread = db.prepare<[string], RawThreadRow>(
    `SELECT ${THREAD_COLUMNS} FROM sync_threads WHERE thread_id = ?`,
  );
  const getThreadProject = db.prepare<[string], { projectId: string | null }>(
    "SELECT project_id AS projectId FROM sync_threads WHERE thread_id = ?",
  );
  const moveThreadEntries = db.prepare<{
    threadId: string;
    projectId: string | null;
  }>(
    "UPDATE usage_entries SET project_id = @projectId WHERE thread_id = @threadId",
  );
  const saveProgress = db.prepare<[string, string, string]>(
    "UPDATE sync_threads SET cursors = ?, baselines = ? WHERE thread_id = ?",
  );
  const markSynced = db.prepare<[number, number, string]>(
    `UPDATE sync_threads SET synced_updated_at = ?, last_synced_at = ?
     WHERE thread_id = ?`,
  );
  const markDeleted = db.prepare<[string]>(
    "UPDATE sync_threads SET deleted = 1 WHERE thread_id = ?",
  );
  const listLiveThreadIds = db.prepare<[], { threadId: string }>(
    `SELECT thread_id AS threadId FROM sync_threads
     WHERE deleted = 0 ORDER BY updated_at DESC`,
  );
  const countIndexed = db.prepare<[], { count: number }>(
    `SELECT COUNT(*) AS count FROM sync_threads
     WHERE last_synced_at IS NOT NULL`,
  );
  const insertEntry = db.prepare<{
    id: string;
    threadId: string;
    seq: number;
    createdAt: number;
    turnId: string | null;
    providerId: string;
    projectId: string | null;
    model: string | null;
    isSubagent: number;
    source: EntrySource;
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    reasoning: number;
    total: number;
  }>(
    `INSERT OR IGNORE INTO usage_entries (
       id, thread_id, seq, created_at, turn_id, provider_id, project_id, model,
       is_subagent, source, input_tokens, cache_read_tokens,
       cache_write_tokens, output_tokens, reasoning_tokens, total_tokens,
       first_of_turn
     ) VALUES (
       @id, @threadId, @seq, @createdAt, @turnId, @providerId, @projectId,
       @model, @isSubagent, @source, @input, @cacheRead, @cacheWrite, @output,
       @reasoning, @total,
       @source = 'live' AND NOT EXISTS (
         SELECT 1 FROM usage_entries e
         WHERE e.thread_id = @threadId AND e.turn_id = @turnId
           AND e.source = 'live'
           AND (e.created_at < @createdAt
             OR (e.created_at = @createdAt AND e.id < @id))
       )
     )`,
  );
  const clearLaterFirstOfTurn = db.prepare<{
    id: string;
    threadId: string;
    turnId: string;
    createdAt: number;
  }>(
    `UPDATE usage_entries SET first_of_turn = 0
     WHERE thread_id = @threadId AND turn_id = @turnId AND first_of_turn = 1
       AND (created_at > @createdAt
         OR (created_at = @createdAt AND id > @id))`,
  );
  const recordTurn = db.prepare<[string, string, string | null, number]>(
    `INSERT OR IGNORE INTO thread_turns
       (thread_id, turn_id, parent_tool_call_id, seq) VALUES (?, ?, ?, ?)`,
  );
  const getTurn = db.prepare<
    [string, string],
    { parentToolCallId: string | null }
  >(
    `SELECT parent_tool_call_id AS parentToolCallId FROM thread_turns
     WHERE thread_id = ? AND turn_id = ?`,
  );
  const recordRequest = db.prepare<[string, string, string, number]>(
    `INSERT OR IGNORE INTO turn_requests (thread_id, request_id, model, seq)
     VALUES (?, ?, ?, ?)`,
  );
  const recordInput = db.prepare<[string, string, string, number]>(
    `INSERT OR IGNORE INTO turn_inputs (thread_id, request_id, turn_id, seq)
     VALUES (?, ?, ?, ?)`,
  );
  const recordFallback = db.prepare<
    [string, string, string | null, string, number]
  >(
    `INSERT OR IGNORE INTO model_fallbacks
       (id, thread_id, turn_id, fallback_model, seq) VALUES (?, ?, ?, ?, ?)`,
  );
  const resolveModel = db.prepare<
    { threadId: string; turnId: string | null; seq: number },
    { model: string | null }
  >(
    `SELECT COALESCE(
       (SELECT f.fallback_model FROM model_fallbacks f
          WHERE f.thread_id = @threadId AND f.turn_id = @turnId
          ORDER BY f.seq DESC LIMIT 1),
       (SELECT f.fallback_model FROM model_fallbacks f
          JOIN thread_turns t
            ON t.thread_id = f.thread_id AND t.turn_id = @turnId
          WHERE f.thread_id = @threadId AND f.turn_id IS NULL
            AND f.seq < t.seq
            AND NOT EXISTS (
              SELECT 1 FROM thread_turns o
              WHERE o.thread_id = f.thread_id
                AND o.seq > f.seq AND o.seq < t.seq
            )
          ORDER BY f.seq DESC LIMIT 1),
       (SELECT r.model FROM turn_inputs i
          JOIN turn_requests r
            ON r.thread_id = i.thread_id AND r.request_id = i.request_id
          WHERE i.thread_id = @threadId AND i.turn_id = @turnId
          ORDER BY i.seq ASC LIMIT 1),
       (SELECT c.model FROM context_snapshots c
          WHERE c.thread_id = @threadId),
       (SELECT r.model FROM turn_requests r
          WHERE r.thread_id = @threadId AND r.seq < @seq
          ORDER BY r.seq DESC LIMIT 1)
     ) AS model`,
  );
  const upsertSubagentTask = db.prepare<SubagentTaskRecord>(
    `INSERT INTO subagent_tasks (
       thread_id, item_id, turn_id, created_at, total_tokens, tool_uses,
       duration_ms, seq
     ) VALUES (
       @threadId, @itemId, @turnId, @createdAt, @totalTokens, @toolUses,
       @durationMs, @seq
     )
     ON CONFLICT(thread_id, item_id) DO UPDATE SET
       turn_id = excluded.turn_id,
       created_at = excluded.created_at,
       total_tokens = excluded.total_tokens,
       tool_uses = excluded.tool_uses,
       duration_ms = excluded.duration_ms,
       seq = excluded.seq
     WHERE excluded.seq > subagent_tasks.seq`,
  );
  const upsertContext = db.prepare<{
    threadId: string;
    seq: number;
    createdAt: number;
    model: string | null;
    usedTokens: number;
    windowTokens: number | null;
    categories: string;
  }>(
    `INSERT INTO context_snapshots (
       thread_id, seq, created_at, model, used_tokens, window_tokens,
       categories
     ) VALUES (
       @threadId, @seq, @createdAt, @model, @usedTokens, @windowTokens,
       @categories
     )
     ON CONFLICT(thread_id) DO UPDATE SET
       seq = excluded.seq,
       created_at = excluded.created_at,
       model = excluded.model,
       used_tokens = excluded.used_tokens,
       window_tokens = excluded.window_tokens,
       categories = excluded.categories
     WHERE excluded.seq > context_snapshots.seq`,
  );
  const insertEntryAndFlagTurn = db.transaction(
    (entry: LedgerEntry): boolean => {
      const inserted =
        insertEntry.run({
          id: entry.id,
          threadId: entry.threadId,
          seq: entry.seq,
          createdAt: entry.createdAt,
          turnId: entry.turnId,
          providerId: entry.providerId,
          projectId: entry.projectId,
          model: entry.model,
          isSubagent: entry.isSubagent ? 1 : 0,
          source: entry.source,
          input: entry.tokens.input,
          cacheRead: entry.tokens.cacheRead,
          cacheWrite: entry.tokens.cacheWrite,
          output: entry.tokens.output,
          reasoning: entry.tokens.reasoning,
          total: entry.tokens.total,
        }).changes > 0;
      if (inserted && entry.source === "live" && entry.turnId !== null) {
        clearLaterFirstOfTurn.run({
          id: entry.id,
          threadId: entry.threadId,
          turnId: entry.turnId,
          createdAt: entry.createdAt,
        });
      }
      return inserted;
    },
  );

  const upsertThreadAndMoveEntries = db.transaction(
    (meta: ThreadMeta): { needsSync: boolean } => {
      const previous = getThreadProject.get(meta.threadId);
      const row = upsertThread.get({
        threadId: meta.threadId,
        projectId: meta.projectId,
        providerId: meta.providerId,
        parentThreadId: meta.parentThreadId,
        sourceThreadId: meta.sourceThreadId,
        title: meta.title,
        titleFallback: meta.titleFallback,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        archived: meta.archived ? 1 : 0,
        deleted: meta.deleted ? 1 : 0,
      });
      if (previous !== undefined && previous.projectId !== meta.projectId) {
        moveThreadEntries.run({
          threadId: meta.threadId,
          projectId: meta.projectId,
        });
      }
      const syncedUpdatedAt = row?.syncedUpdatedAt ?? null;
      return {
        needsSync:
          !meta.deleted &&
          (syncedUpdatedAt === null || syncedUpdatedAt < meta.updatedAt),
      };
    },
  );

  return {
    db,
    transaction<T>(work: () => T): T {
      return db.transaction(work)();
    },
    trackingSinceMs(): number | null {
      return getMeta.get(META_TRACKING_SINCE)?.value ?? null;
    },
    ensureTrackingSince(now: number): void {
      insertMetaIfMissing.run(META_TRACKING_SINCE, now);
    },
    lastIndexedAtMs(): number | null {
      return getMeta.get(META_LAST_INDEXED)?.value ?? null;
    },
    upsertThread(meta: ThreadMeta): { needsSync: boolean } {
      return upsertThreadAndMoveEntries(meta);
    },
    thread(threadId: string): ThreadSyncState | null {
      const raw = getThread.get(threadId);
      return raw === undefined ? null : decodeThread(raw);
    },
    saveSyncProgress(args: {
      threadId: string;
      cursors: Record<string, number>;
      baselines: Record<string, StreamBaseline>;
    }): void {
      saveProgress.run(
        JSON.stringify(args.cursors),
        JSON.stringify(args.baselines),
        args.threadId,
      );
    },
    markSynced(args: {
      threadId: string;
      syncedUpdatedAt: number;
      now: number;
    }): void {
      markSynced.run(args.syncedUpdatedAt, args.now, args.threadId);
      setMeta.run(META_LAST_INDEXED, args.now);
    },
    markDeleted(threadId: string): void {
      markDeleted.run(threadId);
    },
    liveThreadIds(): string[] {
      return listLiveThreadIds.all().map((row) => row.threadId);
    },
    indexedThreadCount(): number {
      return countIndexed.get()?.count ?? 0;
    },
    insertEntry(entry: LedgerEntry): boolean {
      return insertEntryAndFlagTurn(entry);
    },
    recordTurn(args: {
      threadId: string;
      turnId: string;
      parentToolCallId: string | null;
      seq: number;
    }): void {
      recordTurn.run(
        args.threadId,
        args.turnId,
        args.parentToolCallId,
        args.seq,
      );
    },
    turnParentToolCallId(threadId: string, turnId: string): string | null {
      return getTurn.get(threadId, turnId)?.parentToolCallId ?? null;
    },
    recordRequest(args: {
      threadId: string;
      requestId: string;
      model: string;
      seq: number;
    }): void {
      recordRequest.run(args.threadId, args.requestId, args.model, args.seq);
    },
    recordInput(args: {
      threadId: string;
      requestId: string;
      turnId: string;
      seq: number;
    }): void {
      recordInput.run(args.threadId, args.requestId, args.turnId, args.seq);
    },
    recordFallback(args: {
      id: string;
      threadId: string;
      turnId: string | null;
      model: string;
      seq: number;
    }): void {
      recordFallback.run(
        args.id,
        args.threadId,
        args.turnId,
        args.model,
        args.seq,
      );
    },
    resolveModel(args: {
      threadId: string;
      turnId: string | null;
      seq: number;
    }): string | null {
      return resolveModel.get(args)?.model ?? null;
    },
    upsertSubagentTask(task: SubagentTaskRecord): boolean {
      return upsertSubagentTask.run(task).changes > 0;
    },
    upsertContextSnapshot(snapshot: ContextSnapshotRecord): boolean {
      return (
        upsertContext.run({
          threadId: snapshot.threadId,
          seq: snapshot.seq,
          createdAt: snapshot.createdAt,
          model: snapshot.model,
          usedTokens: snapshot.usedTokens,
          windowTokens: snapshot.windowTokens,
          categories: JSON.stringify(snapshot.categories),
        }).changes > 0
      );
    },
  };
}
