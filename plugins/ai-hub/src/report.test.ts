import { describe, expect, it } from "vitest";
import type { UsageFilters } from "./contract";
import { createReporter } from "./report";
import {
  openLedger,
  seedEntry,
  seedThread,
  staticLabels,
  tokens,
} from "./test-fixtures";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function setup(now: number) {
  const ledger = openLedger();
  const reporter = createReporter({
    store: ledger.store,
    queries: ledger.queries,
    labels: staticLabels(),
    indexer: { status: () => ({ pendingThreads: 0, scanning: false }) },
    now: () => now,
  });
  return { ...ledger, reporter };
}

function filters(overrides: Partial<UsageFilters>): UsageFilters {
  return {
    range: "30d",
    projectId: null,
    providerId: null,
    timeZone: "UTC",
    ...overrides,
  };
}

describe("usage report timeline", () => {
  it("buckets days by New York local midnight across the end of DST", async () => {
    const now = Date.UTC(2026, 10, 3, 17);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_dst" });
    const at = (ms: number, total: number) =>
      seedEntry(t.store, {
        threadId: "thr_dst",
        createdAt: ms,
        tokens: tokens({ input: total }),
      });
    at(Date.UTC(2026, 9, 28, 3, 59), 1);
    at(Date.UTC(2026, 9, 28, 4, 0), 2);
    at(Date.UTC(2026, 10, 1, 4, 30), 10);
    at(Date.UTC(2026, 10, 2, 4, 30), 20);
    at(Date.UTC(2026, 10, 2, 5, 15), 40);

    const report = await t.reporter.report(
      filters({ range: "7d", timeZone: "America/New_York" }),
    );

    expect(report.range).toEqual({
      startMs: Date.UTC(2026, 9, 28, 4),
      endMs: now,
      bucket: "day",
    });
    expect(
      report.timeline.map((point) => [
        point.label,
        point.startMs,
        point.totalTokens,
      ]),
    ).toEqual([
      ["2026-10-28", Date.UTC(2026, 9, 28, 4), 2],
      ["2026-10-29", Date.UTC(2026, 9, 29, 4), 0],
      ["2026-10-30", Date.UTC(2026, 9, 30, 4), 0],
      ["2026-10-31", Date.UTC(2026, 9, 31, 4), 0],
      ["2026-11-01", Date.UTC(2026, 10, 1, 4), 30],
      ["2026-11-02", Date.UTC(2026, 10, 2, 5), 40],
      ["2026-11-03", Date.UTC(2026, 10, 3, 5), 0],
    ]);
    expect(report.totals.totalTokens).toBe(72);
    expect(report.totals.turns).toBe(4);
  });

  it("switches an all-time range to Monday weeks after 120 days", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_weeks" });
    seedEntry(t.store, {
      threadId: "thr_weeks",
      createdAt: Date.UTC(2026, 2, 4, 9),
      tokens: tokens({ output: 5 }),
    });
    seedEntry(t.store, {
      threadId: "thr_weeks",
      createdAt: Date.UTC(2026, 9, 14, 9),
      tokens: tokens({ output: 7 }),
    });

    const report = await t.reporter.report(filters({ range: "all" }));

    expect(report.range.bucket).toBe("week");
    expect(report.range.startMs).toBeNull();
    expect(report.previousTotals).toBeNull();
    expect(report.timeline).toHaveLength(33);
    expect(report.timeline[0]).toMatchObject({
      label: "2026-03-02",
      startMs: Date.UTC(2026, 2, 2),
      totalTokens: 5,
      turns: 1,
    });
    expect(report.timeline.at(-1)).toMatchObject({
      label: "2026-10-12",
      totalTokens: 7,
    });
  });

  it("keeps daily buckets for a short all-time range starting at the first entry", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_days" });
    seedEntry(t.store, {
      threadId: "thr_days",
      createdAt: Date.UTC(2026, 9, 10, 9),
      tokens: tokens({ output: 5 }),
    });

    const report = await t.reporter.report(filters({ range: "all" }));

    expect(report.range.bucket).toBe("day");
    expect(report.timeline.map((point) => point.label)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
  });

  it("places activity in local weekday and hour cells", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_ist" });
    seedEntry(t.store, {
      threadId: "thr_ist",
      createdAt: Date.UTC(2026, 9, 13, 20),
      tokens: tokens({ input: 100 }),
    });
    seedEntry(t.store, {
      threadId: "thr_ist",
      createdAt: Date.UTC(2026, 9, 13, 18, 29),
      tokens: tokens({ input: 7 }),
    });

    const report = await t.reporter.report(
      filters({ range: "7d", timeZone: "Asia/Kolkata" }),
    );

    expect(report.activity).toHaveLength(168);
    expect(report.activity.filter((cell) => cell.totalTokens > 0)).toEqual([
      { weekday: 2, hour: 23, totalTokens: 7, turns: 1 },
      { weekday: 3, hour: 1, totalTokens: 100, turns: 1 },
    ]);
  });

  it("rejects an unknown time zone", async () => {
    const t = setup(Date.UTC(2026, 9, 14));
    await expect(
      t.reporter.report(filters({ timeZone: "Nowhere/Land" })),
    ).rejects.toThrow('Unknown time zone "Nowhere/Land".');
  });
});

describe("usage report totals", () => {
  it("compares with the same-length window before the range", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_prev" });
    const start = Date.UTC(2026, 9, 8);
    const windowMs = now + 1 - start;
    seedEntry(t.store, {
      threadId: "thr_prev",
      createdAt: start + HOUR_MS,
      tokens: tokens({ input: 300 }),
    });
    seedEntry(t.store, {
      threadId: "thr_prev",
      createdAt: start - HOUR_MS,
      tokens: tokens({ input: 120 }),
    });
    seedEntry(t.store, {
      threadId: "thr_prev",
      createdAt: start - windowMs - HOUR_MS,
      tokens: tokens({ input: 999 }),
    });

    const report = await t.reporter.report(filters({ range: "7d" }));

    expect(report.totals.totalTokens).toBe(300);
    expect(report.previousTotals?.totalTokens).toBe(120);
    expect(report.previousTotals?.turns).toBe(1);
  });

  it("counts turns once per live turn and threads once per thread", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_a", providerId: "codex" });
    seedThread(t.store, { threadId: "thr_b" });
    for (const total of [10, 20, 30]) {
      seedEntry(t.store, {
        threadId: "thr_a",
        providerId: "codex",
        model: "gpt-5.5-codex",
        createdAt: now - HOUR_MS,
        turnId: "turn_shared",
        tokens: tokens({ input: total }),
      });
    }
    seedEntry(t.store, {
      threadId: "thr_b",
      createdAt: now - HOUR_MS,
      turnId: "turn_shared",
      tokens: tokens({ input: 1, cacheRead: 3 }),
    });
    seedEntry(t.store, {
      threadId: "thr_b",
      createdAt: now - HOUR_MS,
      turnId: "turn_shared",
      source: "backfill",
      tokens: tokens({ input: 1_000 }),
    });

    const report = await t.reporter.report(filters({ range: "7d" }));

    expect(report.totals).toMatchObject({
      totalTokens: 1_064,
      inputTokens: 1_061,
      cacheReadTokens: 3,
      turns: 2,
      threads: 2,
    });
    expect(report.coverage.backfilledTokens).toBe(1_000);
    expect(
      report.byProvider.map((row) => [row.key, row.label, row.totalTokens]),
    ).toEqual([
      ["claude-code", "Claude Code", 1_004],
      ["codex", "Codex", 60],
    ]);
    expect(report.byModel.map((row) => [row.key, row.label])).toEqual([
      ["claude-opus-5", "Claude Opus 5"],
      ["gpt-5.5-codex", "GPT-5.5 Codex"],
    ]);
  });

  it("filters by project and provider while still offering every option", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_app", projectId: "proj_app" });
    seedThread(t.store, {
      threadId: "thr_docs",
      projectId: "proj_docs",
      providerId: "codex",
    });
    seedEntry(t.store, {
      threadId: "thr_app",
      createdAt: now - DAY_MS,
      tokens: tokens({ output: 50 }),
    });
    seedEntry(t.store, {
      threadId: "thr_docs",
      projectId: "proj_docs",
      providerId: "codex",
      model: null,
      createdAt: now - DAY_MS,
      tokens: tokens({ output: 70 }),
    });
    t.store.upsertSubagentTask({
      threadId: "thr_app",
      itemId: "task_1",
      turnId: null,
      createdAt: now - DAY_MS,
      totalTokens: 900,
      toolUses: 4,
      durationMs: 1_000,
      seq: 1,
    });

    const docs = await t.reporter.report(
      filters({ range: "7d", projectId: "proj_docs" }),
    );
    expect(docs.totals.totalTokens).toBe(70);
    expect(docs.byProject.map((row) => row.label)).toEqual(["Docs"]);
    expect(docs.byModel.map((row) => [row.key, row.label])).toEqual([
      [null, "Unknown model"],
    ]);
    expect(docs.subagents.tasks).toBe(0);
    expect(docs.options).toEqual({
      projects: [
        { id: "proj_app", label: "App" },
        { id: "proj_docs", label: "Docs" },
      ],
      providers: [
        { id: "claude-code", label: "Claude Code" },
        { id: "codex", label: "Codex" },
      ],
    });

    const claude = await t.reporter.report(
      filters({ range: "7d", providerId: "claude-code" }),
    );
    expect(claude.totals.totalTokens).toBe(50);
    expect(claude.subagents).toEqual({
      tasks: 1,
      totalTokens: 900,
      toolUses: 4,
      durationMs: 1_000,
    });
  });

  it("ranks top threads with titles, dominant models, and flags", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, {
      threadId: "thr_big",
      title: null,
      titleFallback: "Fallback title",
    });
    seedThread(t.store, { threadId: "thr_small", title: "  " });
    seedEntry(t.store, {
      threadId: "thr_big",
      createdAt: now - 3 * HOUR_MS,
      model: "claude-opus-5",
      tokens: tokens({ input: 100 }),
    });
    seedEntry(t.store, {
      threadId: "thr_big",
      createdAt: now - 2 * HOUR_MS,
      model: "gpt-5.5-codex",
      tokens: tokens({ input: 400 }),
    });
    seedEntry(t.store, {
      threadId: "thr_big",
      createdAt: now - HOUR_MS,
      model: "claude-opus-5",
      source: "backfill",
      tokens: tokens({ input: 200 }),
    });
    seedEntry(t.store, {
      threadId: "thr_small",
      createdAt: now - HOUR_MS,
      tokens: tokens({ input: 5 }),
    });
    t.store.markDeleted("thr_small");

    const report = await t.reporter.report(filters({ range: "7d" }));

    expect(report.topThreads).toEqual([
      expect.objectContaining({
        threadId: "thr_big",
        title: "Fallback title",
        projectName: "App",
        model: "GPT-5.5 Codex",
        totalTokens: 700,
        turns: 2,
        lastActivityMs: now - HOUR_MS,
        hasBackfill: true,
        deleted: false,
      }),
      expect.objectContaining({
        threadId: "thr_small",
        title: "Untitled thread",
        deleted: true,
        hasBackfill: false,
      }),
    ]);
  });

  it("averages context snapshots of threads active in the range", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    for (const threadId of ["thr_ctx_a", "thr_ctx_b", "thr_ctx_idle"]) {
      seedThread(t.store, { threadId });
    }
    for (const threadId of ["thr_ctx_a", "thr_ctx_b"]) {
      seedEntry(t.store, {
        threadId,
        createdAt: now - HOUR_MS,
        tokens: tokens({ input: 1 }),
      });
    }
    seedEntry(t.store, {
      threadId: "thr_ctx_idle",
      createdAt: now - 60 * DAY_MS,
      tokens: tokens({ input: 1 }),
    });
    const snapshot = (
      threadId: string,
      skills: number,
      extra: { label: string; tokens: number }[],
    ) =>
      t.store.upsertContextSnapshot({
        threadId,
        seq: 1,
        createdAt: now - HOUR_MS,
        model: "claude-opus-5",
        usedTokens: 10_000 + skills,
        windowTokens: 200_000,
        categories: [
          { label: "Free space", kind: "free", tokens: 150_000, entries: [] },
          {
            label: "Skills",
            kind: "used",
            tokens: skills,
            entries: [{ label: "bb-cli", tokens: skills }, ...extra],
          },
        ],
      });
    snapshot("thr_ctx_a", 2_000, [{ label: "trees", tokens: 9_000 }]);
    snapshot("thr_ctx_b", 4_000, []);
    snapshot("thr_ctx_idle", 90_000, []);

    const report = await t.reporter.report(filters({ range: "7d" }));

    expect(report.context).toEqual({
      threads: 2,
      averageUsedTokens: 13_000,
      averageWindowTokens: 200_000,
      categories: [
        { label: "Skills", kind: "used", averageTokens: 3_000, threads: 2 },
        {
          label: "Free space",
          kind: "free",
          averageTokens: 150_000,
          threads: 2,
        },
      ],
      topEntries: [
        {
          category: "Skills",
          label: "trees",
          averageTokens: 4_500,
          threads: 1,
        },
        {
          category: "Skills",
          label: "bb-cli",
          averageTokens: 3_000,
          threads: 2,
        },
      ],
    });

    const empty = await t.reporter.report(
      filters({ range: "7d", projectId: "proj_docs" }),
    );
    expect(empty.context).toBeNull();
  });

  it("averages each context category and entry over every snapshot, counting a missing one as zero", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    for (let index = 0; index < 10; index += 1) {
      const threadId = `thr_ctx_${index}`;
      seedThread(t.store, { threadId });
      seedEntry(t.store, {
        threadId,
        createdAt: now - HOUR_MS,
        tokens: tokens({ input: 1 }),
      });
      const withMcp = index === 0;
      t.store.upsertContextSnapshot({
        threadId,
        seq: 1,
        createdAt: now - HOUR_MS,
        model: "claude-opus-5",
        usedTokens: withMcp ? 62_000 : 22_000,
        windowTokens: 200_000,
        categories: [
          {
            label: "Messages",
            kind: "used",
            tokens: 20_000,
            entries: [{ label: "bb-cli", tokens: 2_000 }],
          },
          ...(withMcp
            ? [
                {
                  label: "MCP tools",
                  kind: "used",
                  tokens: 40_000,
                  entries: [{ label: "linear", tokens: 9_000 }],
                },
              ]
            : []),
        ],
      });
    }

    const report = await t.reporter.report(filters({ range: "7d" }));

    expect(report.context?.averageUsedTokens).toBe(26_000);
    expect(report.context?.categories).toEqual([
      { label: "Messages", kind: "used", averageTokens: 20_000, threads: 10 },
      { label: "MCP tools", kind: "used", averageTokens: 4_000, threads: 1 },
    ]);
    expect(report.context?.topEntries).toEqual([
      {
        category: "Messages",
        label: "bb-cli",
        averageTokens: 2_000,
        threads: 10,
      },
      {
        category: "MCP tools",
        label: "linear",
        averageTokens: 900,
        threads: 1,
      },
    ]);
  });

  it("reads each filter's options from the ledger once per report", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const ledger = openLedger();
    const requested: string[] = [];
    const reporter = createReporter({
      store: ledger.store,
      queries: {
        ...ledger.queries,
        ledgerKeys(dimension) {
          requested.push(dimension);
          return ledger.queries.ledgerKeys(dimension);
        },
      },
      labels: staticLabels(),
      indexer: { status: () => ({ pendingThreads: 0, scanning: false }) },
      now: () => now,
    });
    seedThread(ledger.store, { threadId: "thr_used", providerId: "codex" });
    seedThread(ledger.store, {
      threadId: "thr_unused",
      projectId: "proj_docs",
    });
    seedEntry(ledger.store, {
      threadId: "thr_used",
      providerId: "codex",
      createdAt: now - HOUR_MS,
      tokens: tokens({ input: 1 }),
    });

    const report = await reporter.report(filters({ range: "7d" }));

    expect([...requested].sort()).toEqual(["project", "provider"]);
    expect(report.options).toEqual({
      projects: [{ id: "proj_app", label: "App" }],
      providers: [{ id: "codex", label: "Codex" }],
    });
  });
});

describe("thread usage detail", () => {
  it("returns null for a thread the ledger has never seen", async () => {
    const t = setup(Date.UTC(2026, 9, 14));
    expect(await t.reporter.threadUsage("thr_missing")).toBeNull();
  });

  it("lists entries oldest first with resolved model names", async () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const t = setup(now);
    seedThread(t.store, { threadId: "thr_detail", title: "Fix the editor" });
    seedEntry(t.store, {
      id: "evt_1",
      threadId: "thr_detail",
      createdAt: now - 2 * HOUR_MS,
      turnId: "turn_1",
      model: "claude-opus-5[1m]",
      tokens: tokens({ input: 10, cacheRead: 30, output: 5 }),
    });
    seedEntry(t.store, {
      id: "evt_2",
      threadId: "thr_detail",
      createdAt: now - HOUR_MS,
      turnId: "turn_2",
      model: "claude-opus-5",
      tokens: tokens({ input: 20, output: 5 }),
    });
    t.store.upsertSubagentTask({
      threadId: "thr_detail",
      itemId: "task_1",
      turnId: null,
      createdAt: now - HOUR_MS,
      totalTokens: 500,
      toolUses: 2,
      durationMs: 3_000,
      seq: 5,
    });

    const detail = await t.reporter.threadUsage("thr_detail");

    expect(detail?.thread).toMatchObject({
      threadId: "thr_detail",
      title: "Fix the editor",
      model: "Claude Opus 5 (1M)",
      totalTokens: 70,
      turns: 2,
      lastActivityMs: now - HOUR_MS,
    });
    expect(detail?.entries.map((entry) => [entry.id, entry.model])).toEqual([
      ["evt_1", "Claude Opus 5 (1M)"],
      ["evt_2", "Claude Opus 5"],
    ]);
    expect(detail?.subagentTasks).toHaveLength(1);
  });
});
