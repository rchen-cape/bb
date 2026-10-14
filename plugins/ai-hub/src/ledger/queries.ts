import { z } from "zod";
import type { EntrySource } from "../contract.js";
import type { Db } from "./store.js";

export const BUCKET_MS = 15 * 60 * 1000;

export interface EntryScope {
  startMs: number | null;
  endMs: number | null;
  projectId: string | null;
  providerId: string | null;
}

export interface TokenSums {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface TotalsRow extends TokenSums {
  turns: number;
  threads: number;
}

export interface BucketRow extends TokenSums {
  bucket: number;
}

export interface BucketTurnsRow {
  bucket: number;
  turns: number;
}

export interface GroupRow extends TotalsRow {
  key: string | null;
}

export const BREAKDOWN_COLUMNS = {
  model: "model",
  project: "project_id",
  provider: "provider_id",
} as const;
export type BreakdownDimension = keyof typeof BREAKDOWN_COLUMNS;

export interface TopThreadRow extends TotalsRow {
  threadId: string;
  lastActivityMs: number;
  hasBackfill: number;
  title: string | null;
  titleFallback: string | null;
  projectId: string | null;
  providerId: string;
  deleted: number;
}

export interface SubagentSums {
  tasks: number;
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

export interface ContextOverviewRow {
  threads: number;
  averageUsedTokens: number | null;
  averageWindowTokens: number | null;
}

export interface ContextCategoryRow {
  label: string;
  kind: string;
  totalTokens: number;
  threads: number;
}

export interface ContextEntryRow {
  category: string;
  label: string;
  totalTokens: number;
  threads: number;
}

export interface ThreadEntryRow extends TokenSums {
  id: string;
  providerId: string;
  projectId: string | null;
  createdAtMs: number;
  turnId: string | null;
  model: string | null;
  isSubagent: number;
  source: EntrySource;
}

export interface SubagentTaskRow {
  itemId: string;
  turnId: string | null;
  createdAtMs: number;
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

export interface ThreadInfoRow {
  threadId: string;
  title: string | null;
  titleFallback: string | null;
  projectId: string | null;
  providerId: string;
  updatedAt: number;
  deleted: number;
}

const entrySourceRowSchema = z.enum(["live", "backfill"]);

const TOKEN_SUMS = `COALESCE(SUM(input_tokens), 0) AS inputTokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
  COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
  COALESCE(SUM(output_tokens), 0) AS outputTokens,
  COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
  COALESCE(SUM(total_tokens), 0) AS totalTokens`;

const TURN_COUNT = `COALESCE(SUM(first_of_turn), 0) AS turns`;

type Params = Record<string, string | number>;

function scopeClause(
  scope: EntryScope,
  prefix: string,
): {
  sql: string;
  params: Params;
} {
  const conditions: string[] = [];
  const params: Params = {};
  if (scope.startMs !== null) {
    conditions.push(`${prefix}created_at >= @startMs`);
    params.startMs = scope.startMs;
  }
  if (scope.endMs !== null) {
    conditions.push(`${prefix}created_at < @endMs`);
    params.endMs = scope.endMs;
  }
  if (scope.projectId !== null) {
    conditions.push(`${prefix}project_id = @projectId`);
    params.projectId = scope.projectId;
  }
  if (scope.providerId !== null) {
    conditions.push(`${prefix}provider_id = @providerId`);
    params.providerId = scope.providerId;
  }
  return {
    sql: conditions.length === 0 ? "1 = 1" : conditions.join(" AND "),
    params,
  };
}

function snapshotInScope(scope: EntryScope): { sql: string; params: Params } {
  const where = scopeClause(scope, "e.");
  return {
    sql: `EXISTS (
      SELECT 1 FROM usage_entries e
      WHERE e.thread_id = c.thread_id AND ${where.sql}
    )`,
    params: where.params,
  };
}

export type LedgerQueries = ReturnType<typeof createLedgerQueries>;

export function createLedgerQueries(db: Db) {
  function all<Row>(sql: string, params: Params): Row[] {
    return Object.keys(params).length === 0
      ? db.prepare<[], Row>(sql).all()
      : db.prepare<[Params], Row>(sql).all(params);
  }

  function one<Row>(sql: string, params: Params): Row | undefined {
    return all<Row>(sql, params)[0];
  }

  return {
    totals(scope: EntryScope): TotalsRow {
      const where = scopeClause(scope, "");
      return (
        one<TotalsRow>(
          `SELECT ${TOKEN_SUMS}, ${TURN_COUNT},
             COUNT(DISTINCT thread_id) AS threads
           FROM usage_entries WHERE ${where.sql}`,
          where.params,
        ) ?? {
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          turns: 0,
          threads: 0,
        }
      );
    },
    backfilledTokens(scope: EntryScope): number {
      const where = scopeClause(scope, "");
      return (
        one<{ total: number }>(
          `SELECT COALESCE(SUM(total_tokens), 0) AS total FROM usage_entries
           WHERE ${where.sql} AND source = 'backfill'`,
          where.params,
        )?.total ?? 0
      );
    },
    firstEntryAt(scope: EntryScope): number | null {
      const where = scopeClause(scope, "");
      return (
        one<{ first: number | null }>(
          `SELECT MIN(created_at) AS first FROM usage_entries
           WHERE ${where.sql}`,
          where.params,
        )?.first ?? null
      );
    },
    tokenBuckets(scope: EntryScope): BucketRow[] {
      const where = scopeClause(scope, "");
      return all<BucketRow>(
        `SELECT created_at / ${BUCKET_MS} AS bucket, ${TOKEN_SUMS}
         FROM usage_entries WHERE ${where.sql}
         GROUP BY bucket ORDER BY bucket`,
        where.params,
      );
    },
    turnBuckets(scope: EntryScope): BucketTurnsRow[] {
      const where = scopeClause(scope, "");
      return all<BucketTurnsRow>(
        `SELECT created_at / ${BUCKET_MS} AS bucket,
           SUM(first_of_turn) AS turns
         FROM usage_entries
         WHERE ${where.sql} AND first_of_turn = 1
         GROUP BY bucket ORDER BY bucket`,
        where.params,
      );
    },
    breakdown(scope: EntryScope, dimension: BreakdownDimension): GroupRow[] {
      const where = scopeClause(scope, "");
      const column = BREAKDOWN_COLUMNS[dimension];
      return all<GroupRow>(
        `SELECT ${column} AS key, ${TOKEN_SUMS}, ${TURN_COUNT},
           COUNT(DISTINCT thread_id) AS threads
         FROM usage_entries WHERE ${where.sql}
         GROUP BY ${column} ORDER BY totalTokens DESC`,
        where.params,
      );
    },
    topThreads(scope: EntryScope, limit: number): TopThreadRow[] {
      const where = scopeClause(scope, "e.");
      return all<TopThreadRow>(
        `SELECT e.thread_id AS threadId,
           COALESCE(SUM(e.input_tokens), 0) AS inputTokens,
           COALESCE(SUM(e.cache_read_tokens), 0) AS cacheReadTokens,
           COALESCE(SUM(e.cache_write_tokens), 0) AS cacheWriteTokens,
           COALESCE(SUM(e.output_tokens), 0) AS outputTokens,
           COALESCE(SUM(e.reasoning_tokens), 0) AS reasoningTokens,
           COALESCE(SUM(e.total_tokens), 0) AS totalTokens,
           COALESCE(SUM(e.first_of_turn), 0) AS turns,
           1 AS threads,
           MAX(e.created_at) AS lastActivityMs,
           MAX(e.source = 'backfill') AS hasBackfill,
           t.title AS title, t.title_fallback AS titleFallback,
           COALESCE(t.project_id, MAX(e.project_id)) AS projectId,
           COALESCE(t.provider_id, MAX(e.provider_id)) AS providerId,
           COALESCE(t.deleted, 0) AS deleted
         FROM usage_entries e
         LEFT JOIN sync_threads t ON t.thread_id = e.thread_id
         WHERE ${where.sql}
         GROUP BY e.thread_id
         ORDER BY totalTokens DESC, lastActivityMs DESC
         LIMIT ${Math.max(1, Math.trunc(limit))}`,
        where.params,
      );
    },
    dominantModels(
      scope: EntryScope,
      threadIds: readonly string[],
    ): Map<string, string | null> {
      const where = scopeClause(scope, "");
      const rows = all<{ threadId: string; model: string | null }>(
        `SELECT threadId, model FROM (
           SELECT thread_id AS threadId, model,
             ROW_NUMBER() OVER (
               PARTITION BY thread_id
               ORDER BY SUM(total_tokens) DESC, model IS NULL, model
             ) AS rank
           FROM usage_entries
           WHERE ${where.sql}
             AND thread_id IN (SELECT value FROM json_each(@threadIds))
           GROUP BY thread_id, model
         ) WHERE rank = 1`,
        { ...where.params, threadIds: JSON.stringify(threadIds) },
      );
      return new Map(rows.map((row) => [row.threadId, row.model]));
    },
    subagents(scope: EntryScope): SubagentSums {
      const conditions: string[] = [];
      const params: Params = {};
      if (scope.startMs !== null) {
        conditions.push("s.created_at >= @startMs");
        params.startMs = scope.startMs;
      }
      if (scope.endMs !== null) {
        conditions.push("s.created_at < @endMs");
        params.endMs = scope.endMs;
      }
      if (scope.projectId !== null) {
        conditions.push("t.project_id = @projectId");
        params.projectId = scope.projectId;
      }
      if (scope.providerId !== null) {
        conditions.push("t.provider_id = @providerId");
        params.providerId = scope.providerId;
      }
      return (
        one<SubagentSums>(
          `SELECT COUNT(*) AS tasks,
             COALESCE(SUM(s.total_tokens), 0) AS totalTokens,
             COALESCE(SUM(s.tool_uses), 0) AS toolUses,
             COALESCE(SUM(s.duration_ms), 0) AS durationMs
           FROM subagent_tasks s
           JOIN sync_threads t ON t.thread_id = s.thread_id
           WHERE ${conditions.length === 0 ? "1 = 1" : conditions.join(" AND ")}`,
          params,
        ) ?? { tasks: 0, totalTokens: 0, toolUses: 0, durationMs: 0 }
      );
    },
    contextOverview(scope: EntryScope): ContextOverviewRow {
      const inScope = snapshotInScope(scope);
      return (
        one<ContextOverviewRow>(
          `SELECT COUNT(*) AS threads,
             AVG(c.used_tokens) AS averageUsedTokens,
             AVG(c.window_tokens) AS averageWindowTokens
           FROM context_snapshots c
           WHERE ${inScope.sql}`,
          inScope.params,
        ) ?? { threads: 0, averageUsedTokens: null, averageWindowTokens: null }
      );
    },
    contextCategories(scope: EntryScope): ContextCategoryRow[] {
      const inScope = snapshotInScope(scope);
      return all<ContextCategoryRow>(
        `SELECT json_extract(category.value, '$.label') AS label,
           MIN(json_extract(category.value, '$.kind')) AS kind,
           COALESCE(SUM(json_extract(category.value, '$.tokens')), 0)
             AS totalTokens,
           COUNT(DISTINCT c.thread_id) AS threads
         FROM context_snapshots c, json_each(c.categories) AS category
         WHERE ${inScope.sql}
         GROUP BY label`,
        inScope.params,
      );
    },
    contextEntries(scope: EntryScope, limit: number): ContextEntryRow[] {
      const inScope = snapshotInScope(scope);
      return all<ContextEntryRow>(
        `SELECT json_extract(category.value, '$.label') AS category,
           json_extract(entry.value, '$.label') AS label,
           COALESCE(SUM(json_extract(entry.value, '$.tokens')), 0)
             AS totalTokens,
           COUNT(DISTINCT c.thread_id) AS threads
         FROM context_snapshots c,
           json_each(c.categories) AS category,
           json_each(category.value, '$.entries') AS entry
         WHERE ${inScope.sql}
         GROUP BY category, label
         ORDER BY totalTokens DESC, threads DESC, label
         LIMIT ${Math.max(1, Math.trunc(limit))}`,
        inScope.params,
      );
    },
    ledgerKeys(dimension: "project" | "provider"): string[] {
      const column = BREAKDOWN_COLUMNS[dimension];
      return all<{ key: string }>(
        `SELECT t.${column} AS key FROM sync_threads t
         WHERE t.${column} IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM usage_entries e
             WHERE e.thread_id = t.thread_id
             LIMIT 1
           )
         GROUP BY t.${column}`,
        {},
      ).map((row) => row.key);
    },
    threadInfo(threadId: string): ThreadInfoRow | undefined {
      return one<ThreadInfoRow>(
        `SELECT thread_id AS threadId, title, title_fallback AS titleFallback,
           project_id AS projectId, provider_id AS providerId,
           updated_at AS updatedAt, deleted
         FROM sync_threads WHERE thread_id = @threadId`,
        { threadId },
      );
    },
    threadEntries(threadId: string): ThreadEntryRow[] {
      return all<ThreadEntryRow>(
        `SELECT id, provider_id AS providerId, project_id AS projectId,
           created_at AS createdAtMs, turn_id AS turnId, model,
           is_subagent AS isSubagent, source,
           input_tokens AS inputTokens, cache_read_tokens AS cacheReadTokens,
           cache_write_tokens AS cacheWriteTokens,
           output_tokens AS outputTokens, reasoning_tokens AS reasoningTokens,
           total_tokens AS totalTokens
         FROM usage_entries WHERE thread_id = @threadId
         ORDER BY seq, source DESC`,
        { threadId },
      ).map((row) => ({
        ...row,
        source: entrySourceRowSchema.parse(row.source),
      }));
    },
    threadSubagentTasks(threadId: string): SubagentTaskRow[] {
      return all<SubagentTaskRow>(
        `SELECT item_id AS itemId, turn_id AS turnId,
           created_at AS createdAtMs, total_tokens AS totalTokens,
           tool_uses AS toolUses, duration_ms AS durationMs
         FROM subagent_tasks WHERE thread_id = @threadId
         ORDER BY created_at, item_id`,
        { threadId },
      );
    },
  };
}
