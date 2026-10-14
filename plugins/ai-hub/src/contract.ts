import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const AI_HUB_PANEL_PATH = "ai";
export const USAGE_REALTIME_CHANNEL = "usage";

export const RANGE_PRESETS = ["7d", "30d", "90d", "all"] as const;
export const rangePresetSchema = z.enum(RANGE_PRESETS);
export type RangePreset = z.infer<typeof rangePresetSchema>;

export const ENTRY_SOURCES = ["live", "backfill"] as const;
export const entrySourceSchema = z.enum(ENTRY_SOURCES);
export type EntrySource = z.infer<typeof entrySourceSchema>;

const count = z.number().int().nonnegative();

export const tokenTotalsSchema = z
  .object({
    inputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
    outputTokens: count,
    reasoningTokens: count,
    totalTokens: count,
    turns: count,
  })
  .strict();
export type TokenTotals = z.infer<typeof tokenTotalsSchema>;

export const usageFiltersSchema = z
  .object({
    range: rangePresetSchema,
    projectId: z.string().min(1).nullable(),
    providerId: z.string().min(1).nullable(),
    timeZone: z.string().min(1).max(64),
  })
  .strict();
export type UsageFilters = z.infer<typeof usageFiltersSchema>;

export const coverageSchema = z
  .object({
    trackingSinceMs: z.number().int().nullable(),
    backfilledTokens: count,
    indexedThreads: count,
    pendingThreads: count,
    scanning: z.boolean(),
    lastIndexedAtMs: z.number().int().nullable(),
  })
  .strict();
export type Coverage = z.infer<typeof coverageSchema>;

export const timelinePointSchema = tokenTotalsSchema
  .extend({
    startMs: z.number().int(),
    label: z.string(),
  })
  .strict();
export type TimelinePoint = z.infer<typeof timelinePointSchema>;

export const breakdownRowSchema = tokenTotalsSchema
  .extend({
    key: z.string().nullable(),
    label: z.string(),
    threads: count,
  })
  .strict();
export type BreakdownRow = z.infer<typeof breakdownRowSchema>;

export const threadUsageRowSchema = tokenTotalsSchema
  .extend({
    threadId: z.string().min(1),
    title: z.string(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    providerId: z.string(),
    model: z.string().nullable(),
    lastActivityMs: z.number().int(),
    deleted: z.boolean(),
    hasBackfill: z.boolean(),
  })
  .strict();
export type ThreadUsageRow = z.infer<typeof threadUsageRowSchema>;

export const activityCellSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    totalTokens: count,
    turns: count,
  })
  .strict();
export type ActivityCell = z.infer<typeof activityCellSchema>;

export const subagentSummarySchema = z
  .object({
    tasks: count,
    totalTokens: count,
    toolUses: count,
    durationMs: count,
  })
  .strict();
export type SubagentSummary = z.infer<typeof subagentSummarySchema>;

export const contextCategorySchema = z
  .object({
    label: z.string(),
    kind: z.string(),
    averageTokens: count,
    threads: count,
  })
  .strict();

export const contextEntrySchema = z
  .object({
    category: z.string(),
    label: z.string(),
    averageTokens: count,
    threads: count,
  })
  .strict();

export const contextSummarySchema = z
  .object({
    threads: count,
    averageUsedTokens: count,
    averageWindowTokens: count.nullable(),
    categories: z.array(contextCategorySchema),
    topEntries: z.array(contextEntrySchema),
  })
  .strict();
export type ContextSummary = z.infer<typeof contextSummarySchema>;

export const filterOptionSchema = z
  .object({ id: z.string().min(1), label: z.string() })
  .strict();
export type FilterOption = z.infer<typeof filterOptionSchema>;

export const usageReportSchema = z
  .object({
    generatedAtMs: z.number().int(),
    filters: usageFiltersSchema,
    range: z
      .object({
        startMs: z.number().int().nullable(),
        endMs: z.number().int(),
        bucket: z.enum(["day", "week"]),
      })
      .strict(),
    coverage: coverageSchema,
    totals: tokenTotalsSchema.extend({ threads: count }).strict(),
    previousTotals: tokenTotalsSchema.nullable(),
    timeline: z.array(timelinePointSchema),
    byModel: z.array(breakdownRowSchema),
    byProject: z.array(breakdownRowSchema),
    byProvider: z.array(breakdownRowSchema),
    topThreads: z.array(threadUsageRowSchema),
    activity: z.array(activityCellSchema),
    subagents: subagentSummarySchema,
    context: contextSummarySchema.nullable(),
    options: z
      .object({
        projects: z.array(filterOptionSchema),
        providers: z.array(filterOptionSchema),
      })
      .strict(),
  })
  .strict();
export type UsageReport = z.infer<typeof usageReportSchema>;

export const usageEntrySchema = z
  .object({
    id: z.string().min(1),
    createdAtMs: z.number().int(),
    turnId: z.string().nullable(),
    model: z.string().nullable(),
    isSubagent: z.boolean(),
    source: entrySourceSchema,
    inputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
    outputTokens: count,
    reasoningTokens: count,
    totalTokens: count,
  })
  .strict();
export type UsageEntry = z.infer<typeof usageEntrySchema>;

export const subagentTaskSchema = z
  .object({
    itemId: z.string().min(1),
    turnId: z.string().nullable(),
    createdAtMs: z.number().int(),
    totalTokens: count,
    toolUses: count,
    durationMs: count,
  })
  .strict();
export type SubagentTask = z.infer<typeof subagentTaskSchema>;

export const threadDetailSchema = z
  .object({
    thread: threadUsageRowSchema,
    entries: z.array(usageEntrySchema),
    subagentTasks: z.array(subagentTaskSchema),
  })
  .strict();
export type ThreadDetail = z.infer<typeof threadDetailSchema>;

export const aiHubRpcContract = defineRpcContract({
  report: {
    input: usageFiltersSchema,
    output: usageReportSchema,
  },
  threadUsage: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: threadDetailSchema.nullable(),
  },
  status: {
    input: z.null(),
    output: coverageSchema,
  },
  rescan: {
    input: z.null(),
    output: z.object({ queuedThreads: count }).strict(),
  },
});
export type AiHubRpcContract = typeof aiHubRpcContract;
