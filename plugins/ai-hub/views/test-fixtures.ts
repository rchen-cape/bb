import {
  threadDetailSchema,
  usageReportSchema,
  type BreakdownRow,
  type Coverage,
  type ThreadDetail,
  type TimelinePoint,
  type TokenTotals,
  type UsageFilters,
  type UsageReport,
} from "../src/contract.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const FIXTURE_NOW_MS = Date.UTC(2026, 9, 14, 18, 0, 0);
const FIRST_DAY_MS = Date.UTC(2026, 8, 15, 12, 0, 0);
export const LAST_BUCKET_INPUT = 12_345;

export const DEFAULT_FIXTURE_FILTERS: UsageFilters = {
  range: "30d",
  projectId: null,
  providerId: null,
  timeZone: "UTC",
};

function totalsOf(parts: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  turns: number;
}): TokenTotals {
  return {
    inputTokens: parts.inputTokens,
    cacheReadTokens: parts.cacheReadTokens,
    cacheWriteTokens: parts.cacheWriteTokens,
    outputTokens: parts.outputTokens,
    reasoningTokens: parts.reasoningTokens ?? 0,
    totalTokens:
      parts.inputTokens +
      parts.cacheReadTokens +
      parts.cacheWriteTokens +
      parts.outputTokens,
    turns: parts.turns,
  };
}

function addTotals(rows: readonly TokenTotals[]): TokenTotals {
  return rows.reduce<TokenTotals>(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + row.cacheWriteTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      reasoningTokens: sum.reasoningTokens + row.reasoningTokens,
      totalTokens: sum.totalTokens + row.totalTokens,
      turns: sum.turns + row.turns,
    }),
    totalsOf({
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      turns: 0,
    }),
  );
}

function scaled(totals: TokenTotals, share: number): TokenTotals {
  return totalsOf({
    inputTokens: Math.round(totals.inputTokens * share),
    cacheReadTokens: Math.round(totals.cacheReadTokens * share),
    cacheWriteTokens: Math.round(totals.cacheWriteTokens * share),
    outputTokens: Math.round(totals.outputTokens * share),
    reasoningTokens: Math.round(totals.reasoningTokens * share),
    turns: Math.round(totals.turns * share),
  });
}

function breakdown(
  totals: TokenTotals,
  rows: readonly {
    key: string | null;
    label: string;
    share: number;
    threads: number;
  }[],
): BreakdownRow[] {
  return rows.map((row) => ({
    ...scaled(totals, row.share),
    key: row.key,
    label: row.label,
    threads: row.threads,
  }));
}

function timeline(): TimelinePoint[] {
  return Array.from({ length: 30 }, (_, index) => {
    const last = index === 29;
    const startMs = FIRST_DAY_MS + index * DAY_MS;
    return {
      ...totalsOf({
        inputTokens: last ? LAST_BUCKET_INPUT : 1_000 + index * 37,
        cacheReadTokens: 20_000 + index * 900,
        cacheWriteTokens: 3_000 + (index % 5) * 200,
        outputTokens: 800 + index * 21,
        reasoningTokens: index % 3 === 0 ? 120 : 0,
        turns: 5 + (index % 4),
      }),
      startMs,
      label: new Date(startMs).toISOString().slice(0, 10),
    };
  });
}

function coverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    trackingSinceMs: Date.UTC(2026, 9, 1, 9, 0, 0),
    backfilledTokens: 64_000,
    indexedThreads: 42,
    pendingThreads: 0,
    scanning: false,
    lastIndexedAtMs: FIXTURE_NOW_MS - 60_000,
    ...overrides,
  };
}

export function reportFixture(
  filters: UsageFilters = DEFAULT_FIXTURE_FILTERS,
): UsageReport {
  const points = timeline();
  const totals = addTotals(points);
  return usageReportSchema.parse({
    generatedAtMs: FIXTURE_NOW_MS,
    filters,
    range: {
      startMs: filters.range === "all" ? null : FIRST_DAY_MS,
      endMs: FIXTURE_NOW_MS,
      bucket: "day",
    },
    coverage: coverage(),
    totals: { ...totals, threads: 12 },
    previousTotals: filters.range === "all" ? null : scaled(totals, 0.8),
    timeline: points,
    byModel: breakdown(totals, [
      { key: "claude-opus-4", label: "claude-opus-4", share: 0.62, threads: 7 },
      { key: "gpt-5-codex", label: "gpt-5-codex", share: 0.33, threads: 4 },
      { key: null, label: "Unknown model", share: 0.05, threads: 1 },
    ]),
    byProject: breakdown(totals, [
      { key: "proj_api", label: "API server", share: 0.7, threads: 8 },
      { key: "proj_web", label: "Web app", share: 0.3, threads: 4 },
    ]),
    byProvider: breakdown(totals, [
      { key: "claude-code", label: "Claude Code", share: 0.67, threads: 8 },
      { key: "codex", label: "Codex", share: 0.33, threads: 4 },
    ]),
    topThreads: [
      {
        ...scaled(totals, 0.41),
        threadId: "thr_login",
        title: "Fix login redirect",
        projectId: "proj_api",
        projectName: "API server",
        providerId: "claude-code",
        model: "claude-opus-4",
        lastActivityMs: FIXTURE_NOW_MS - 2 * 60 * 60 * 1000,
        deleted: false,
        hasBackfill: true,
      },
      {
        ...scaled(totals, 0.18),
        threadId: "thr_docs",
        title: "Write API docs",
        projectId: "proj_web",
        projectName: "Web app",
        providerId: "codex",
        model: "gpt-5-codex",
        lastActivityMs: FIXTURE_NOW_MS - 3 * DAY_MS,
        deleted: true,
        hasBackfill: false,
      },
    ],
    activity: [
      { weekday: 1, hour: 9, totalTokens: 180_000, turns: 31 },
      { weekday: 1, hour: 14, totalTokens: 95_000, turns: 18 },
      { weekday: 3, hour: 22, totalTokens: 40_000, turns: 6 },
      { weekday: 0, hour: 11, totalTokens: 12_000, turns: 2 },
    ],
    subagents: {
      tasks: 3,
      totalTokens: 48_200,
      toolUses: 27,
      durationMs: 412_000,
    },
    context: {
      threads: 9,
      averageUsedTokens: 67_900,
      averageWindowTokens: 200_000,
      categories: [
        {
          label: "System prompt",
          kind: "used",
          averageTokens: 3_200,
          threads: 9,
        },
        {
          label: "System tools",
          kind: "used",
          averageTokens: 14_000,
          threads: 9,
        },
        {
          label: "MCP tools",
          kind: "used",
          averageTokens: 6_000,
          threads: 5,
        },
        {
          label: "Memory files",
          kind: "used",
          averageTokens: 1_800,
          threads: 6,
        },
        { label: "Skills", kind: "used", averageTokens: 900, threads: 9 },
        {
          label: "Messages",
          kind: "used",
          averageTokens: 42_000,
          threads: 9,
        },
        {
          label: "Free space",
          kind: "free",
          averageTokens: 132_100,
          threads: 9,
        },
      ],
      topEntries: [
        {
          category: "MCP tools",
          label: "mcp__linear",
          averageTokens: 3_900,
          threads: 4,
        },
        {
          category: "Memory files",
          label: "CLAUDE.md",
          averageTokens: 1_700,
          threads: 6,
        },
        { category: "Skills", label: "bb-cli", averageTokens: 420, threads: 9 },
      ],
    },
    options: {
      projects: [
        { id: "proj_api", label: "API server" },
        { id: "proj_web", label: "Web app" },
      ],
      providers: [
        { id: "claude-code", label: "Claude Code" },
        { id: "codex", label: "Codex" },
      ],
    },
  });
}

export function emptyReportFixture(
  filters: UsageFilters = DEFAULT_FIXTURE_FILTERS,
): UsageReport {
  const zero = totalsOf({
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    turns: 0,
  });
  return usageReportSchema.parse({
    ...reportFixture(filters),
    coverage: coverage({
      trackingSinceMs: null,
      backfilledTokens: 0,
      indexedThreads: 30,
      pendingThreads: 12,
      scanning: true,
    }),
    totals: { ...zero, threads: 0 },
    previousTotals: filters.range === "all" ? null : zero,
    timeline: [],
    byModel: [],
    byProject: [],
    byProvider: [],
    topThreads: [],
    activity: [],
    subagents: { tasks: 0, totalTokens: 0, toolUses: 0, durationMs: 0 },
    context: null,
  });
}

function entryTokens(parts: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}) {
  const totals = totalsOf({ ...parts, turns: 0 });
  return {
    inputTokens: totals.inputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
  };
}

export function threadDetailFixture(): ThreadDetail {
  const entries = [
    {
      id: "use_1",
      createdAtMs: FIXTURE_NOW_MS - 5 * 60 * 60 * 1000,
      turnId: null,
      model: "claude-opus-4",
      isSubagent: false,
      source: "backfill",
      ...entryTokens({
        inputTokens: 4_100,
        cacheReadTokens: 88_000,
        cacheWriteTokens: 9_000,
        outputTokens: 2_400,
      }),
    },
    {
      id: "use_2",
      createdAtMs: FIXTURE_NOW_MS - 3 * 60 * 60 * 1000,
      turnId: "turn_01JABCDEF123456",
      model: "claude-opus-4",
      isSubagent: false,
      source: "live",
      ...entryTokens({
        inputTokens: 1_250,
        cacheReadTokens: 31_000,
        cacheWriteTokens: 1_800,
        outputTokens: 940,
      }),
    },
    {
      id: "use_3",
      createdAtMs: FIXTURE_NOW_MS - 2 * 60 * 60 * 1000,
      turnId: "turn_01JABCDEF654321",
      model: "claude-sonnet-4",
      isSubagent: true,
      source: "live",
      ...entryTokens({
        inputTokens: 600,
        cacheReadTokens: 12_400,
        cacheWriteTokens: 0,
        outputTokens: 330,
      }),
    },
  ];
  const totals = addTotals(entries.map((entry) => ({ ...entry, turns: 0 })));
  return threadDetailSchema.parse({
    thread: {
      ...totals,
      turns: 2,
      threadId: "thr_login",
      title: "Fix login redirect",
      projectId: "proj_api",
      projectName: "API server",
      providerId: "claude-code",
      model: "claude-opus-4",
      lastActivityMs: FIXTURE_NOW_MS - 2 * 60 * 60 * 1000,
      deleted: false,
      hasBackfill: true,
    },
    entries,
    subagentTasks: [
      {
        itemId: "item_task_1",
        turnId: "turn_01JABCDEF123456",
        createdAtMs: FIXTURE_NOW_MS - 3 * 60 * 60 * 1000,
        totalTokens: 18_200,
        toolUses: 9,
        durationMs: 125_000,
      },
    ],
  });
}
