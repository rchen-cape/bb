import { describe, expect, it } from "vitest";
import { createAiHubCli, formatCompact, formatPercent } from "./cli";
import { createReporter } from "./report";
import {
  openLedger,
  seedEntry,
  seedThread,
  staticLabels,
  tokens,
} from "./test-fixtures";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 14, 12);

function setup() {
  const ledger = openLedger();
  ledger.store.ensureTrackingSince(Date.UTC(2026, 9, 1, 9, 12));
  const reporter = createReporter({
    store: ledger.store,
    queries: ledger.queries,
    labels: staticLabels(),
    indexer: { status: () => ({ pendingThreads: 0, scanning: false }) },
    now: () => NOW,
  });
  let rescans = 0;
  const cli = createAiHubCli({
    api: {
      report: reporter.report,
      threadUsage: reporter.threadUsage,
      status: reporter.coverage,
      rescan: () => {
        rescans += 1;
        return { queuedThreads: 2 };
      },
    },
    timeZone: () => "UTC",
  });
  return { ...ledger, cli, rescans: () => rescans };
}

function seedUsage(t: ReturnType<typeof setup>) {
  seedThread(t.store, {
    threadId: "thr_editor",
    title: "Fix the notes editor colors",
  });
  seedThread(t.store, {
    threadId: "thr_codex",
    title: "Port the indexer",
    providerId: "codex",
    projectId: "proj_docs",
  });
  seedEntry(t.store, {
    threadId: "thr_editor",
    createdAt: NOW - 2 * HOUR_MS,
    turnId: "turn_1",
    tokens: tokens({
      input: 1_200,
      cacheRead: 98_000,
      cacheWrite: 4_000,
      output: 2_100,
    }),
  });
  seedEntry(t.store, {
    threadId: "thr_editor",
    createdAt: NOW - HOUR_MS,
    turnId: "turn_2",
    tokens: tokens({
      input: 800,
      cacheRead: 120_000,
      cacheWrite: 1_000,
      output: 3_300,
    }),
  });
  seedEntry(t.store, {
    threadId: "thr_editor",
    createdAt: NOW - HOUR_MS,
    turnId: "turn_2",
    source: "backfill",
    tokens: tokens({ input: 5_000, cacheRead: 400_000, output: 9_000 }),
  });
  seedEntry(t.store, {
    threadId: "thr_codex",
    providerId: "codex",
    projectId: "proj_docs",
    model: "gpt-5.5-codex",
    createdAt: NOW - 26 * HOUR_MS,
    turnId: "turn_c",
    tokens: tokens({
      input: 30_000,
      cacheRead: 250_000,
      output: 12_000,
      reasoning: 4_000,
    }),
  });
  seedEntry(t.store, {
    threadId: "thr_codex",
    providerId: "codex",
    projectId: "proj_docs",
    model: "gpt-5.5-codex",
    createdAt: NOW - 9 * 24 * HOUR_MS,
    turnId: "turn_old",
    tokens: tokens({ input: 1_000, output: 100 }),
  });
  t.store.upsertSubagentTask({
    threadId: "thr_editor",
    itemId: "task_1",
    turnId: null,
    createdAt: NOW - HOUR_MS,
    totalTokens: 45_000,
    toolUses: 12,
    durationMs: 95_000,
    seq: 9,
  });
}

describe("number formatting", () => {
  it("abbreviates counts and rounds up into the next unit", () => {
    expect(
      [0, 999, 1_000, 12_900, 999_950, 1_234_567, 3_400_000_000].map(
        formatCompact,
      ),
    ).toEqual(["0", "999", "1.0K", "12.9K", "1.0M", "1.2M", "3.4B"]);
  });

  it("prints percentages with one decimal", () => {
    expect(formatPercent(0.8344)).toBe("83.4%");
    expect(formatPercent(1)).toBe("100.0%");
  });
});

describe("bb ai-hub usage", () => {
  it("summarizes totals, change, cache hit rate, top rows, and coverage", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["usage", "--range", "7d"], {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Token usage, last 7 days (2026-10-08 to 2026-10-14, UTC)",
        "",
        "Total tokens    936.4K  +85027.3% vs previous 7 days",
        "Input            37.0K",
        "Cache read      868.0K",
        "Cache write       5.0K",
        "Output           26.4K",
        "Reasoning         4.0K  part of output",
        "Cache hit rate   95.4%",
        "Turns                3",
        "Threads              2",
        "Subagent tasks       1  45.0K tokens, reported separately",
        "",
        "Top models",
        "  Claude Opus 5  644.4K  68.8%",
        "  GPT-5.5 Codex  292.0K  31.2%",
        "",
        "Top projects",
        "  App   644.4K  68.8%",
        "  Docs  292.0K  31.2%",
        "",
        "Tracking since 2026-10-01 09:12. 44.2% of these tokens are estimated from snapshots bb kept.",
        "",
      ].join("\n"),
    );
  });

  it("names the filters it applied", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(
      ["usage", "--range", "7d", "--project", "proj_docs"],
      {},
    );

    expect(result.stdout?.split("\n").slice(0, 4)).toEqual([
      "Token usage, last 7 days (2026-10-08 to 2026-10-14, UTC)",
      "Filtered to project Docs",
      "",
      "Total tokens    292.0K  +26445.5% vs previous 7 days",
    ]);
  });

  it("says so when the range has no usage", async () => {
    const t = setup();

    const result = await t.cli.run(["usage"], {});

    expect(result.stdout).toBe(
      [
        "Token usage, last 30 days (2026-09-15 to 2026-10-14, UTC)",
        "",
        "No token usage recorded in this range.",
        "",
        "Tracking since 2026-10-01 09:12.",
        "",
      ].join("\n"),
    );
  });

  it("emits the report as JSON", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["usage", "--range", "all", "--json"], {});
    const report = JSON.parse(result.stdout ?? "");

    expect(report.filters).toEqual({
      range: "all",
      projectId: null,
      providerId: null,
      timeZone: "UTC",
    });
    expect(report.totals.totalTokens).toBe(937_500);
  });
});

describe("bb ai-hub usage threads, models, and daily", () => {
  it("lists top threads with aligned columns and a backfill marker", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["usage", "threads", "--range", "7d"], {});

    expect(result.stdout).toBe(
      [
        "Top threads, last 7 days (2026-10-08 to 2026-10-14, UTC)",
        "",
        " TOKENS  TURNS  HIT RATE  MODEL          PROJECT  LAST ACTIVE       THREAD      TITLE",
        "644.4K*      2     98.1%  Claude Opus 5  App      2026-10-14 11:00  thr_editor  Fix the notes editor colors",
        "292.0K       1     89.3%  GPT-5.5 Codex  Docs     2026-10-13 10:00  thr_codex   Port the indexer",
        "",
        "* includes tokens estimated from snapshots bb kept",
        "",
      ].join("\n"),
    );
  });

  it("limits the thread list and its JSON", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(
      ["usage", "threads", "--range", "7d", "--limit", "1", "--json"],
      {},
    );
    const body = JSON.parse(result.stdout ?? "");

    expect(
      body.threads.map((row: { threadId: string }) => row.threadId),
    ).toEqual(["thr_editor"]);
    expect(
      (await t.cli.run(["usage", "threads", "--limit", "26"], {})).exitCode,
    ).toBe(1);
  });

  it("breaks usage down by model", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["usage", "models", "--range", "7d"], {});

    expect(result.stdout?.split("\n").slice(2)).toEqual([
      "MODEL           TOTAL  SHARE  INPUT  CACHE READ  CACHE WRITE  OUTPUT  HIT RATE  TURNS  THREADS",
      "Claude Opus 5  644.4K  68.8%   7.0K      618.0K         5.0K   14.4K     98.1%      2        1",
      "GPT-5.5 Codex  292.0K  31.2%  30.0K      250.0K            0   12.0K     89.3%      1        1",
      "",
    ]);
  });

  it("prints one line per day of the range", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["usage", "daily", "--range", "7d"], {});

    expect(result.stdout?.split("\n").slice(2)).toEqual([
      "DATE         TOTAL  INPUT  CACHE READ  CACHE WRITE  OUTPUT  TURNS",
      "2026-10-08       0      0           0            0       0      0",
      "2026-10-09       0      0           0            0       0      0",
      "2026-10-10       0      0           0            0       0      0",
      "2026-10-11       0      0           0            0       0      0",
      "2026-10-12       0      0           0            0       0      0",
      "2026-10-13  292.0K  30.0K      250.0K            0   12.0K      1",
      "2026-10-14  644.4K   7.0K      618.0K         5.0K   14.4K      2",
      "",
    ]);
  });
});

describe("bb ai-hub usage thread", () => {
  it("shows one thread turn by turn with its subagent tasks", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["usage", "thread", "thr_editor"], {});

    expect(result.stdout).toBe(
      [
        "Fix the notes editor colors (thr_editor)",
        "Project App, provider claude-code, model Claude Opus 5, last active 2026-10-14 11:00",
        "",
        "Total tokens    644.4K",
        "Input             7.0K",
        "Cache read      618.0K",
        "Cache write       5.0K",
        "Output           14.4K",
        "Cache hit rate   98.1%",
        "Turns                2",
        "",
        "TIME              KIND       MODEL          INPUT  CACHE READ  CACHE WRITE  OUTPUT   TOTAL",
        "2026-10-14 10:00  turn       Claude Opus 5   1.2K       98.0K         4.0K    2.1K  105.3K",
        "2026-10-14 11:00  turn       Claude Opus 5    800      120.0K         1.0K    3.3K  125.1K",
        "2026-10-14 11:00  estimated  Claude Opus 5   5.0K      400.0K            0    9.0K  414.0K",
        "",
        "Subagent tasks: 1, 45.0K tokens, reported separately",
        "TIME              TOKENS  TOOL USES  DURATION  ITEM",
        "2026-10-14 11:00   45.0K         12    1m 35s  task_1",
        "",
        "Estimated rows are tokens bb's latest snapshot counted that no recorded turn accounts for.",
        "",
      ].join("\n"),
    );
  });

  it("fails with a hint for a thread without usage", async () => {
    const t = setup();

    const result = await t.cli.run(
      ["usage", "thread", "thr_missing", "--json"],
      {},
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: "AI Hub has no usage recorded for thread thr_missing.",
        hint: "Run `bb ai-hub usage threads` to list threads with recorded usage.",
      },
    });
  });
});

describe("bb ai-hub status and rescan", () => {
  it("reports indexer coverage", async () => {
    const t = setup();
    seedUsage(t);

    const result = await t.cli.run(["status"], {});

    expect(result.stdout).toBe(
      [
        "Tracking since    2026-10-01 09:12",
        "Last indexed      never",
        "Indexed threads   0",
        "Pending threads   0",
        "Scanning          no",
        "Estimated tokens  414.0K",
        "",
      ].join("\n"),
    );
  });

  it("queues a rescan", async () => {
    const t = setup();

    const result = await t.cli.run(["rescan"], {});

    expect(result.stdout).toBe("Queued 2 threads for a re-sync.\n");
    expect(t.rescans()).toBe(1);
  });

  it("queues a rescan and reports it as json", async () => {
    const t = setup();

    const result = await t.cli.run(["rescan", "--json"], {});

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual({ queuedThreads: 2 });
    expect(t.rescans()).toBe(1);
  });
});
