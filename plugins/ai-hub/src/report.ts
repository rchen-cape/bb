import type {
  ActivityCell,
  BreakdownRow,
  ContextSummary,
  Coverage,
  FilterOption,
  ThreadDetail,
  ThreadUsageRow,
  TimelinePoint,
  TokenTotals,
  UsageEntry,
  UsageFilters,
  UsageReport,
} from "./contract.js";
import type { Labels, LabelSource } from "./labels.js";
import type { IndexerStatus } from "./ledger/indexer.js";
import {
  BUCKET_MS,
  type BreakdownDimension,
  type EntryScope,
  type GroupRow,
  type LedgerQueries,
  type TokenSums,
  type TotalsRow,
} from "./ledger/queries.js";
import type { LedgerStore } from "./ledger/store.js";
import {
  addDays,
  createZonedClock,
  dateKey,
  daysBetween,
  RANGE_DAYS,
  weekStart,
  type LocalDate,
  type LocalParts,
} from "./time.js";

export const TOP_THREAD_LIMIT = 25;
export const TOP_CONTEXT_ENTRIES = 15;
export const WEEKLY_BUCKET_AFTER_DAYS = 120;
export const UNKNOWN_MODEL_LABEL = "Unknown model";
export const UNTITLED_THREAD = "Untitled thread";

const CONTEXT_KIND_ORDER = ["used", "deferred", "reserved", "free"];

export interface UsageApi {
  report(filters: UsageFilters): Promise<UsageReport>;
  threadUsage(threadId: string): Promise<ThreadDetail | null>;
  status(): Coverage;
  rescan(): { queuedThreads: number };
}

function zeroTotals(): TokenTotals {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    turns: 0,
  };
}

function tokenTotals(row: TotalsRow): TokenTotals {
  return {
    inputTokens: row.inputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    totalTokens: row.totalTokens,
    turns: row.turns,
  };
}

function addSums(target: TokenTotals, sums: TokenSums): void {
  target.inputTokens += sums.inputTokens;
  target.cacheReadTokens += sums.cacheReadTokens;
  target.cacheWriteTokens += sums.cacheWriteTokens;
  target.outputTokens += sums.outputTokens;
  target.reasoningTokens += sums.reasoningTokens;
  target.totalTokens += sums.totalTokens;
}

function byTokensThenLabel<T extends { totalTokens: number; label: string }>(
  left: T,
  right: T,
): number {
  return (
    right.totalTokens - left.totalTokens ||
    left.label.localeCompare(right.label)
  );
}

function threadTitle(row: {
  title: string | null;
  titleFallback: string | null;
}): string {
  for (const candidate of [row.title, row.titleFallback]) {
    if (candidate !== null && candidate.trim().length > 0) return candidate;
  }
  return UNTITLED_THREAD;
}

function breakdownLabel(
  labels: Labels,
  dimension: BreakdownDimension,
  key: string | null,
): string {
  if (dimension === "model") return labels.model(key) ?? UNKNOWN_MODEL_LABEL;
  if (dimension === "provider") {
    return key === null ? "Unknown provider" : labels.provider(key);
  }
  return key === null ? "No project" : (labels.project(key) ?? key);
}

function breakdownRows(
  rows: GroupRow[],
  labels: Labels,
  dimension: BreakdownDimension,
): BreakdownRow[] {
  return rows
    .map((row) => ({
      ...tokenTotals(row),
      key: row.key,
      label: breakdownLabel(labels, dimension, row.key),
      threads: row.threads,
    }))
    .sort(byTokensThenLabel);
}

function contextSummary(
  queries: LedgerQueries,
  scope: EntryScope,
): ContextSummary | null {
  const overview = queries.contextOverview(scope);
  if (overview.threads === 0) return null;
  const kindRank = (kind: string) => {
    const rank = CONTEXT_KIND_ORDER.indexOf(kind);
    return rank === -1 ? CONTEXT_KIND_ORDER.length : rank;
  };
  const perSnapshot = (totalTokens: number) =>
    Math.round(totalTokens / overview.threads);
  return {
    threads: overview.threads,
    averageUsedTokens: Math.round(overview.averageUsedTokens ?? 0),
    averageWindowTokens:
      overview.averageWindowTokens === null
        ? null
        : Math.round(overview.averageWindowTokens),
    categories: queries
      .contextCategories(scope)
      .map((row) => ({
        label: row.label,
        kind: row.kind,
        averageTokens: perSnapshot(row.totalTokens),
        threads: row.threads,
      }))
      .sort(
        (left, right) =>
          kindRank(left.kind) - kindRank(right.kind) ||
          right.averageTokens - left.averageTokens ||
          left.label.localeCompare(right.label),
      ),
    topEntries: queries
      .contextEntries(scope, TOP_CONTEXT_ENTRIES)
      .map((row) => ({
        category: row.category,
        label: row.label,
        averageTokens: perSnapshot(row.totalTokens),
        threads: row.threads,
      })),
  };
}

function filterOptions(
  ids: string[],
  label: (id: string) => string,
): FilterOption[] {
  return ids
    .map((id) => ({ id, label: label(id) }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    );
}

export function createReporter(deps: {
  store: LedgerStore;
  queries: LedgerQueries;
  labels: LabelSource;
  indexer: { status(): IndexerStatus };
  now: () => number;
}) {
  const { store, queries } = deps;

  function coverage(scope: EntryScope): Coverage {
    const status = deps.indexer.status();
    return {
      trackingSinceMs: store.trackingSinceMs(),
      backfilledTokens: queries.backfilledTokens(scope),
      indexedThreads: store.indexedThreadCount(),
      pendingThreads: status.pendingThreads,
      scanning: status.scanning,
      lastIndexedAtMs: store.lastIndexedAtMs(),
    };
  }

  async function report(filters: UsageFilters): Promise<UsageReport> {
    const clock = createZonedClock(filters.timeZone);
    const now = deps.now();
    const endMs = now + 1;
    const today = clock.parts(now);
    const scopeBase = {
      projectId: filters.projectId,
      providerId: filters.providerId,
      endMs,
    };
    let startMs: number | null = null;
    let firstDate: LocalDate | null = null;
    let bucket: "day" | "week" = "day";
    if (filters.range === "all") {
      const firstAt = queries.firstEntryAt({ ...scopeBase, startMs: null });
      if (firstAt !== null) {
        const first = clock.parts(firstAt);
        bucket =
          daysBetween(first, today) > WEEKLY_BUCKET_AFTER_DAYS ? "week" : "day";
        firstDate = bucket === "week" ? weekStart(first) : first;
      }
    } else {
      firstDate = addDays(today, 1 - RANGE_DAYS[filters.range]);
      startMs = clock.dayStart(firstDate);
    }
    const scope: EntryScope = { ...scopeBase, startMs };
    const projectIds = queries.ledgerKeys("project");
    const providerIds = queries.ledgerKeys("provider");
    const labels = await deps.labels.resolve({ providerIds });

    const partsCache = new Map<number, LocalParts>();
    const partsOf = (bucketIndex: number): LocalParts => {
      const cached = partsCache.get(bucketIndex);
      if (cached !== undefined) return cached;
      const parts = clock.parts(
        Math.max(bucketIndex * BUCKET_MS, startMs ?? Number.MIN_SAFE_INTEGER),
      );
      partsCache.set(bucketIndex, parts);
      return parts;
    };
    const timelineKey = (parts: LocalParts) =>
      dateKey(bucket === "week" ? weekStart(parts) : parts);

    const timeline = new Map<string, TimelinePoint>();
    if (firstDate !== null) {
      const step = bucket === "week" ? 7 : 1;
      for (
        let date = firstDate;
        daysBetween(date, today) >= 0;
        date = addDays(date, step)
      ) {
        const label = dateKey(date);
        timeline.set(label, {
          ...zeroTotals(),
          startMs: clock.dayStart(date),
          label,
        });
      }
    }
    const activity: ActivityCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        activity.push({ weekday, hour, totalTokens: 0, turns: 0 });
      }
    }
    const cellOf = (parts: LocalParts) =>
      activity[parts.weekday * 24 + parts.hour];

    for (const row of queries.tokenBuckets(scope)) {
      const parts = partsOf(row.bucket);
      const point = timeline.get(timelineKey(parts));
      if (point !== undefined) addSums(point, row);
      const cell = cellOf(parts);
      if (cell !== undefined) cell.totalTokens += row.totalTokens;
    }
    for (const row of queries.turnBuckets(scope)) {
      const parts = partsOf(row.bucket);
      const point = timeline.get(timelineKey(parts));
      if (point !== undefined) point.turns += row.turns;
      const cell = cellOf(parts);
      if (cell !== undefined) cell.turns += row.turns;
    }

    const totals = queries.totals(scope);
    const previousTotals =
      startMs === null
        ? null
        : tokenTotals(
            queries.totals({
              ...scope,
              startMs: startMs - (endMs - startMs),
              endMs: startMs,
            }),
          );

    const topRows = queries.topThreads(scope, TOP_THREAD_LIMIT);
    const dominant = queries.dominantModels(
      scope,
      topRows.map((row) => row.threadId),
    );
    const topThreads: ThreadUsageRow[] = topRows.map((row) => ({
      ...tokenTotals(row),
      threadId: row.threadId,
      title: threadTitle(row),
      projectId: row.projectId,
      projectName: labels.project(row.projectId),
      providerId: row.providerId,
      model: labels.model(dominant.get(row.threadId) ?? null),
      lastActivityMs: row.lastActivityMs,
      deleted: row.deleted === 1,
      hasBackfill: row.hasBackfill === 1,
    }));

    return {
      generatedAtMs: now,
      filters,
      range: { startMs, endMs: now, bucket },
      coverage: coverage(scope),
      totals: { ...tokenTotals(totals), threads: totals.threads },
      previousTotals,
      timeline: [...timeline.values()],
      byModel: breakdownRows(
        queries.breakdown(scope, "model"),
        labels,
        "model",
      ),
      byProject: breakdownRows(
        queries.breakdown(scope, "project"),
        labels,
        "project",
      ),
      byProvider: breakdownRows(
        queries.breakdown(scope, "provider"),
        labels,
        "provider",
      ),
      topThreads,
      activity,
      subagents: queries.subagents(scope),
      context: contextSummary(queries, scope),
      options: {
        projects: filterOptions(projectIds, (id) => labels.project(id) ?? id),
        providers: filterOptions(providerIds, (id) => labels.provider(id)),
      },
    };
  }

  async function threadUsage(threadId: string): Promise<ThreadDetail | null> {
    const info = queries.threadInfo(threadId);
    const rows = queries.threadEntries(threadId);
    if (info === undefined && rows.length === 0) return null;
    const providerId = info?.providerId ?? rows[0]?.providerId ?? "unknown";
    const labels = await deps.labels.resolve({ providerIds: [providerId] });
    const totals = zeroTotals();
    const turns = new Set<string>();
    const modelTokens = new Map<string | null, number>();
    let lastEntryAt: number | null = null;
    const entries: UsageEntry[] = [];
    for (const row of rows) {
      addSums(totals, row);
      lastEntryAt = Math.max(lastEntryAt ?? row.createdAtMs, row.createdAtMs);
      if (row.source === "live") turns.add(row.turnId ?? row.id);
      modelTokens.set(
        row.model,
        (modelTokens.get(row.model) ?? 0) + row.totalTokens,
      );
      entries.push({
        id: row.id,
        createdAtMs: row.createdAtMs,
        turnId: row.turnId,
        model: labels.model(row.model),
        isSubagent: row.isSubagent === 1,
        source: row.source,
        inputTokens: row.inputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        totalTokens: row.totalTokens,
      });
    }
    totals.turns = turns.size;
    let dominantModel: string | null = null;
    let dominantTokens = -1;
    for (const [model, tokens] of modelTokens) {
      if (tokens > dominantTokens) {
        dominantModel = model;
        dominantTokens = tokens;
      }
    }
    const projectId = info?.projectId ?? rows[0]?.projectId ?? null;
    return {
      thread: {
        ...totals,
        threadId,
        title: info === undefined ? UNTITLED_THREAD : threadTitle(info),
        projectId,
        projectName: labels.project(projectId),
        providerId,
        model: labels.model(dominantModel),
        lastActivityMs: lastEntryAt ?? info?.updatedAt ?? 0,
        deleted: info?.deleted === 1,
        hasBackfill: rows.some((row) => row.source === "backfill"),
      },
      entries,
      subagentTasks: queries.threadSubagentTasks(threadId),
    };
  }

  return {
    report,
    threadUsage,
    coverage: () =>
      coverage({
        startMs: null,
        endMs: null,
        projectId: null,
        providerId: null,
      }),
  };
}
