import { describe, expect, it } from "vitest";
import {
  claudeUsage,
  codexUsage,
  createFakeThreadsSdk,
  openLedger,
  recordingLog,
  threadRow,
} from "../test-fixtures";
import { createIndexer, EVENT_PAGE_SIZE, type IndexerSdk } from "./indexer";

type FakeThreadsSdk = ReturnType<typeof createFakeThreadsSdk>;

function hangUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

async function settlesWithin(work: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    work.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

async function waitUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!check()) throw new Error("condition never became true");
}

function setup(
  wrapSdk: (fake: FakeThreadsSdk) => IndexerSdk = (fake) => fake.sdk,
) {
  const ledger = openLedger();
  const fake = createFakeThreadsSdk();
  const sdk = wrapSdk(fake);
  const { log, warnings } = recordingLog();
  let changes = 0;
  const indexer = createIndexer({
    sdk: () => sdk,
    store: ledger.store,
    log,
    onChange: () => {
      changes += 1;
    },
    now: () => 50_000,
  });
  const signal = new AbortController().signal;
  return {
    ...ledger,
    fake,
    warnings,
    indexer,
    signal,
    changes: () => changes,
    addThread(row: Parameters<typeof threadRow>[0]) {
      const thread = threadRow(row);
      fake.putThread(thread);
      indexer.noteThread(thread, { sync: false });
      return fake.thread(thread.id);
    },
    entries(threadId: string) {
      return ledger.queries.threadEntries(threadId).map((entry) => ({
        id: entry.id,
        source: entry.source,
        model: entry.model,
        isSubagent: entry.isSubagent === 1,
        input: entry.inputTokens,
        cacheRead: entry.cacheReadTokens,
        cacheWrite: entry.cacheWriteTokens,
        output: entry.outputTokens,
        total: entry.totalTokens,
      }));
    },
  };
}

describe("indexing Claude Code threads", () => {
  it("backfills a turn whose snapshot was pruned before it was read", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_claude" });
    const first = log.turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 1_000,
      last: claudeUsage({ input: 10, cacheRead: 100, output: 5 }),
      total: claudeUsage({ input: 10, cacheRead: 100, output: 5 }),
    });
    await t.indexer.syncThread("thr_claude", t.signal);

    const second = log.turn({
      turnId: "turn_2",
      model: "claude-opus-5",
      at: 2_000,
      last: claudeUsage({ input: 20, cacheRead: 200, output: 6 }),
      total: claudeUsage({ input: 30, cacheRead: 300, output: 11 }),
    });
    const third = log.turn({
      turnId: "turn_3",
      model: "claude-sonnet-5",
      at: 3_000,
      last: claudeUsage({ input: 40, cacheRead: 400, output: 7 }),
      total: claudeUsage({ input: 70, cacheRead: 700, output: 18 }),
    });
    log.prune([first, second]);
    await t.indexer.syncThread("thr_claude", t.signal);

    expect(t.entries("thr_claude")).toEqual([
      {
        id: first,
        source: "live",
        model: "claude-opus-5",
        isSubagent: false,
        input: 10,
        cacheRead: 100,
        cacheWrite: 0,
        output: 5,
        total: 115,
      },
      {
        id: third,
        source: "live",
        model: "claude-sonnet-5",
        isSubagent: false,
        input: 40,
        cacheRead: 400,
        cacheWrite: 0,
        output: 7,
        total: 447,
      },
      {
        id: `${third}:gap`,
        source: "backfill",
        model: "claude-sonnet-5",
        isSubagent: false,
        input: 20,
        cacheRead: 200,
        cacheWrite: 0,
        output: 6,
        total: 226,
      },
    ]);
  });

  it("does not backfill across a session reset that lost nothing", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_reset" });
    log.turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 1_000,
      last: claudeUsage({ input: 500, output: 50 }),
      total: claudeUsage({ input: 500, output: 50 }),
    });
    await t.indexer.syncThread("thr_reset", t.signal);
    log.turn({
      turnId: "turn_2",
      model: "claude-opus-5",
      at: 2_000,
      last: claudeUsage({ input: 30, output: 3 }),
      total: claudeUsage({ input: 30, output: 3 }),
    });
    await t.indexer.syncThread("thr_reset", t.signal);

    expect(
      t.entries("thr_reset").map((entry) => [entry.source, entry.total]),
    ).toEqual([
      ["live", 550],
      ["live", 33],
    ]);
  });

  it("backfills turns missed after a session reset from the new session's total", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_reset_gap" });
    log.turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 1_000,
      last: claudeUsage({ input: 500, output: 50 }),
      total: claudeUsage({ input: 500, output: 50 }),
    });
    await t.indexer.syncThread("thr_reset_gap", t.signal);
    const missed = log.turn({
      turnId: "turn_2",
      model: "claude-opus-5",
      at: 2_000,
      last: claudeUsage({ input: 30, output: 3 }),
      total: claudeUsage({ input: 30, output: 3 }),
    });
    log.turn({
      turnId: "turn_3",
      model: "claude-opus-5",
      at: 3_000,
      last: claudeUsage({ input: 40, output: 4 }),
      total: claudeUsage({ input: 70, output: 7 }),
    });
    log.prune([missed]);
    await t.indexer.syncThread("thr_reset_gap", t.signal);

    expect(
      t.entries("thr_reset_gap").map((entry) => [entry.source, entry.total]),
    ).toEqual([
      ["live", 550],
      ["live", 44],
      ["backfill", 33],
    ]);
  });

  it("splits the one surviving snapshot of an old thread into its last turn and a backfill", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_old" });
    log.request({ requestId: "req_1", model: "claude-opus-5", at: 100 });
    log.start({ turnId: "turn_1", at: 100, requestId: "req_1" });
    log.request({ requestId: "req_2", model: "claude-haiku-5", at: 200 });
    log.start({ turnId: "turn_2", at: 200, requestId: "req_2" });
    log.usage({
      turnId: "turn_2",
      at: 250,
      last: claudeUsage({ input: 5, cacheWrite: 1_000, output: 20 }),
      total: claudeUsage({
        input: 45,
        cacheRead: 9_000,
        cacheWrite: 3_000,
        output: 220,
      }),
    });
    await t.indexer.syncThread("thr_old", t.signal);

    expect(t.entries("thr_old")).toEqual([
      expect.objectContaining({
        source: "live",
        model: "claude-haiku-5",
        input: 5,
        cacheRead: 0,
        cacheWrite: 1_000,
        output: 20,
      }),
      expect.objectContaining({
        source: "backfill",
        model: "claude-haiku-5",
        input: 40,
        cacheRead: 9_000,
        cacheWrite: 2_000,
        output: 200,
      }),
    ]);
  });
});

describe("indexing Codex threads", () => {
  it("records deltas between cumulative totals and skips repeated totals", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_codex", providerId: "codex" });
    log.request({ requestId: "req_1", model: "gpt-5.5-codex", at: 100 });
    log.start({ turnId: "turn_1", at: 100, requestId: "req_1" });
    const first = log.usage({
      turnId: "turn_1",
      at: 110,
      last: codexUsage({ input: 1_000, cached: 600, output: 50 }),
      total: codexUsage({ input: 1_000, cached: 600, output: 50 }),
    });
    log.usage({
      turnId: "turn_1",
      at: 120,
      last: codexUsage({ input: 1_000, cached: 600, output: 50 }),
      total: codexUsage({ input: 1_000, cached: 600, output: 50 }),
    });
    const third = log.usage({
      turnId: "turn_1",
      at: 130,
      last: codexUsage({
        input: 1_500,
        cached: 1_200,
        output: 80,
        reasoning: 30,
      }),
      total: codexUsage({
        input: 2_500,
        cached: 1_800,
        output: 130,
        reasoning: 30,
      }),
    });
    await t.indexer.syncThread("thr_codex", t.signal);

    expect(t.entries("thr_codex")).toEqual([
      {
        id: first,
        source: "live",
        model: "gpt-5.5-codex",
        isSubagent: false,
        input: 400,
        cacheRead: 600,
        cacheWrite: 0,
        output: 50,
        total: 1_050,
      },
      {
        id: third,
        source: "live",
        model: "gpt-5.5-codex",
        isSubagent: false,
        input: 300,
        cacheRead: 1_200,
        cacheWrite: 0,
        output: 80,
        total: 1_580,
      },
    ]);
  });

  it("counts a smaller cumulative total as a reset", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_codex_reset", providerId: "codex" });
    log.turn({
      turnId: "turn_1",
      model: "gpt-5.5-codex",
      at: 100,
      last: codexUsage({ input: 5_000, cached: 4_000, output: 300 }),
      total: codexUsage({ input: 5_000, cached: 4_000, output: 300 }),
    });
    log.turn({
      turnId: "turn_2",
      model: "gpt-5.5-codex",
      at: 200,
      last: codexUsage({ input: 700, cached: 100, output: 40 }),
      total: codexUsage({ input: 700, cached: 100, output: 40 }),
    });
    await t.indexer.syncThread("thr_codex_reset", t.signal);

    expect(t.entries("thr_codex_reset").map((entry) => entry.total)).toEqual([
      5_300, 740,
    ]);
  });

  it("keeps a separate baseline for each subagent stream", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_multi", providerId: "codex" });
    log.turn({
      turnId: "turn_root",
      model: "gpt-5.5-codex",
      at: 100,
      last: codexUsage({ input: 1_000, output: 100 }),
      total: codexUsage({ input: 1_000, output: 100 }),
    });
    log.start({ turnId: "turn_child", at: 150, parentToolCallId: "call_1" });
    log.usage({
      turnId: "turn_child",
      at: 160,
      last: codexUsage({ input: 200, output: 20 }),
      total: codexUsage({ input: 200, output: 20 }),
      providerThreadId: "pt_child",
    });
    log.usage({
      turnId: "turn_child",
      at: 170,
      last: codexUsage({ input: 300, output: 30 }),
      total: codexUsage({ input: 500, output: 50 }),
      providerThreadId: "pt_child",
    });
    log.usage({
      turnId: "turn_root",
      at: 180,
      last: codexUsage({ input: 400, output: 40 }),
      total: codexUsage({ input: 1_400, output: 140 }),
    });
    await t.indexer.syncThread("thr_multi", t.signal);

    expect(
      t.entries("thr_multi").map((entry) => [entry.isSubagent, entry.total]),
    ).toEqual([
      [false, 1_100],
      [true, 220],
      [true, 330],
      [false, 440],
    ]);
    expect(t.entries("thr_multi")[1]?.model).toBe("gpt-5.5-codex");
  });

  it("does not count history a message-edit rewind carried into a new provider thread", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_rewind", providerId: "codex" });
    log.turn({
      turnId: "turn_1",
      model: "gpt-5.5-codex",
      at: 100,
      last: codexUsage({ input: 10_000, output: 100 }),
      total: codexUsage({ input: 10_000, output: 100 }),
    });
    log.turn({
      turnId: "turn_2",
      model: "gpt-5.5-codex",
      at: 200,
      last: codexUsage({ input: 12_000, output: 100 }),
      total: codexUsage({ input: 22_000, output: 200 }),
    });
    await t.indexer.syncThread("thr_rewind", t.signal);
    log.turn({
      turnId: "turn_2_edited",
      model: "gpt-5.5-codex",
      at: 300,
      last: codexUsage({ input: 11_000, output: 50 }),
      total: codexUsage({ input: 21_000, output: 150 }),
      providerThreadId: "pt_rewound",
    });
    await t.indexer.syncThread("thr_rewind", t.signal);

    expect(
      t.entries("thr_rewind").map((entry) => [entry.source, entry.total]),
    ).toEqual([
      ["live", 10_100],
      ["live", 12_100],
      ["live", 11_050],
    ]);
  });

  it("does not count the usage a forked Codex thread inherited from its source", async () => {
    const t = setup();
    const log = t.addThread({
      id: "thr_codex_fork",
      providerId: "codex",
      sourceThreadId: "thr_codex_source",
    });
    log.turn({
      turnId: "turn_fork_1",
      model: "gpt-5.5-codex",
      at: 100,
      last: codexUsage({ input: 1_000, output: 10 }),
      total: codexUsage({ input: 51_000, output: 910 }),
    });
    await t.indexer.syncThread("thr_codex_fork", t.signal);

    expect(
      t.entries("thr_codex_fork").map((entry) => [entry.source, entry.total]),
    ).toEqual([["live", 1_010]]);
  });

  it("does not count a resumed subagent's earlier usage again under its new parent call", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_resume", providerId: "codex" });
    log.start({
      turnId: "turn_spawned",
      at: 100,
      parentToolCallId: "call_spawn",
    });
    log.usage({
      turnId: "turn_spawned",
      at: 110,
      last: codexUsage({ input: 5_000, output: 500 }),
      total: codexUsage({ input: 5_000, output: 500 }),
    });
    log.start({
      turnId: "turn_resumed",
      at: 200,
      parentToolCallId: "call_resume",
    });
    log.usage({
      turnId: "turn_resumed",
      at: 210,
      last: codexUsage({ input: 200, output: 20 }),
      total: codexUsage({ input: 5_200, output: 520 }),
    });
    await t.indexer.syncThread("thr_resume", t.signal);

    expect(
      t
        .entries("thr_resume")
        .map((entry) => [entry.source, entry.isSubagent, entry.total]),
    ).toEqual([
      ["live", true, 5_500],
      ["live", true, 220],
    ]);
  });

  it("marks Codex calls it never saw as backfill", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_codex_gap", providerId: "codex" });
    log.turn({
      turnId: "turn_1",
      model: "gpt-5.5-codex",
      at: 100,
      last: codexUsage({ input: 9_000, output: 1_000 }),
      total: codexUsage({ input: 9_000, output: 1_000 }),
    });
    await t.indexer.syncThread("thr_codex_gap", t.signal);
    const missed = log.turn({
      turnId: "turn_2",
      model: "gpt-5.5-codex",
      at: 200,
      last: codexUsage({ input: 290_000, output: 1_000 }),
      total: codexUsage({ input: 299_000, output: 2_000 }),
    });
    log.turn({
      turnId: "turn_3",
      model: "gpt-5.5-codex",
      at: 300,
      last: codexUsage({ input: 4_500, output: 500 }),
      total: codexUsage({ input: 502_000, output: 8_000 }),
    });
    log.prune([missed]);
    await t.indexer.syncThread("thr_codex_gap", t.signal);

    expect(
      t.entries("thr_codex_gap").map((entry) => [entry.source, entry.total]),
    ).toEqual([
      ["live", 10_000],
      ["live", 5_000],
      ["backfill", 495_000],
    ]);
  });
});

describe("sync bookkeeping", () => {
  it("never counts the same usage twice, even when progress was lost", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_idem" });
    log.turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 1_000,
      last: claudeUsage({ input: 10, output: 5 }),
      total: claudeUsage({ input: 50, output: 25 }),
    });
    const before = t.store.thread("thr_idem");
    await t.indexer.syncThread("thr_idem", t.signal);
    await t.indexer.syncThread("thr_idem", t.signal);
    expect(t.entries("thr_idem")).toHaveLength(2);

    if (before === null) throw new Error("thread missing");
    t.store.saveSyncProgress({
      threadId: "thr_idem",
      cursors: before.cursors,
      baselines: before.baselines,
    });
    await t.indexer.syncThread("thr_idem", t.signal);
    expect(t.entries("thr_idem").map((entry) => entry.total)).toEqual([15, 60]);
  });

  it("pages through more events than one request returns", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_long" });
    for (let turn = 1; turn <= EVENT_PAGE_SIZE; turn += 1) {
      log.turn({
        turnId: `turn_${turn}`,
        model: "claude-opus-5",
        at: turn * 1_000,
        last: claudeUsage({ input: 1, output: 1 }),
        total: claudeUsage({ input: turn, output: turn }),
      });
    }
    await t.indexer.syncThread("thr_long", t.signal);

    const entries = t.entries("thr_long");
    expect(entries).toHaveLength(EVENT_PAGE_SIZE);
    expect(entries.every((entry) => entry.source === "live")).toBe(true);
    expect(t.fake.eventListCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("retries with smaller pages when a page is too large to return", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_huge" });
    for (let turn = 1; turn <= 6; turn += 1) {
      log.turn({
        turnId: `turn_${turn}`,
        model: "claude-opus-5",
        at: turn * 1_000,
        last: claudeUsage({ input: 1, output: 1 }),
        total: claudeUsage({ input: turn, output: turn }),
      });
    }
    t.fake.capPageSize("thr_huge", 10);
    await t.indexer.syncThread("thr_huge", t.signal);

    expect(t.entries("thr_huge")).toHaveLength(6);
    expect(
      t.entries("thr_huge").every((entry) => entry.source === "live"),
    ).toBe(true);
  });

  it("skips background tasks a fork copied from its source thread", async () => {
    const t = setup();
    const log = t.addThread({
      id: "thr_fork",
      sourceThreadId: "thr_source",
      createdAt: 5_000,
    });
    log.backgroundTask({
      itemId: "task_copied",
      at: 4_000,
      totalTokens: 9_000,
      toolUses: 9,
      durationMs: 900,
    });
    log.backgroundTask({
      itemId: "task_own",
      at: 6_000,
      totalTokens: 1_200,
      toolUses: 3,
      durationMs: 400,
    });
    await t.indexer.syncThread("thr_fork", t.signal);

    expect(t.queries.threadSubagentTasks("thr_fork")).toEqual([
      {
        itemId: "task_own",
        turnId: null,
        createdAtMs: 6_000,
        totalTokens: 1_200,
        toolUses: 3,
        durationMs: 400,
      },
    ]);
    expect(t.changes()).toBe(0);
  });

  it("logs a thread that fails and keeps indexing the rest", async () => {
    const t = setup();
    t.addThread({ id: "thr_broken" });
    const healthy = t.addThread({ id: "thr_healthy" });
    healthy.turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 1_000,
      last: claudeUsage({ input: 3, output: 1 }),
      total: claudeUsage({ input: 3, output: 1 }),
    });
    t.fake.failEvents("thr_broken", new Error("boom"));
    t.indexer.noteThread(threadRow({ id: "thr_broken" }), { sync: true });
    t.indexer.noteThread(threadRow({ id: "thr_healthy" }), { sync: true });
    await t.indexer.drain(t.signal);

    expect(t.warnings).toEqual([
      "AI Hub could not index thread thr_broken: boom",
    ]);
    expect(t.entries("thr_healthy")).toHaveLength(1);
    expect(t.changes()).toBe(1);
    expect(t.indexer.status()).toEqual({ pendingThreads: 0, scanning: false });
  });
});

describe("model resolution", () => {
  it("prefers a fallback, then the requested model, then the context snapshot, then the thread's latest request", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_models" });
    log.turn({
      turnId: "turn_requested",
      model: "claude-opus-5",
      at: 100,
      last: claudeUsage({ input: 1, output: 1 }),
      total: claudeUsage({ input: 1, output: 1 }),
    });
    log.request({ requestId: "req_fb", model: "claude-opus-5", at: 200 });
    log.start({ turnId: "turn_fallback", at: 200, requestId: "req_fb" });
    log.fallback({
      turnId: "turn_fallback",
      model: "claude-sonnet-5",
      at: 210,
    });
    log.usage({
      turnId: "turn_fallback",
      at: 220,
      last: claudeUsage({ input: 2, output: 1 }),
      total: claudeUsage({ input: 3, output: 2 }),
    });
    log.fallback({ turnId: null, model: "claude-haiku-5", at: 300 });
    log.start({ turnId: "turn_session_fallback", at: 310 });
    log.usage({
      turnId: "turn_session_fallback",
      at: 320,
      last: claudeUsage({ input: 3, output: 1 }),
      total: claudeUsage({ input: 6, output: 3 }),
    });
    log.start({ turnId: "turn_latest_request", at: 400 });
    log.usage({
      turnId: "turn_latest_request",
      at: 420,
      last: claudeUsage({ input: 4, output: 1 }),
      total: claudeUsage({ input: 10, output: 4 }),
    });
    log.context({
      at: 500,
      model: "claude-opus-5[1m]",
      usedTokens: 20_000,
      windowTokens: 1_000_000,
      categories: [],
    });
    log.start({ turnId: "turn_context", at: 510 });
    log.usage({
      turnId: "turn_context",
      at: 520,
      last: claudeUsage({ input: 5, output: 1 }),
      total: claudeUsage({ input: 15, output: 5 }),
    });
    await t.indexer.syncThread("thr_models", t.signal);

    expect(t.entries("thr_models").map((entry) => entry.model)).toEqual([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-5",
      "claude-opus-5",
      "claude-opus-5[1m]",
    ]);
  });

  it("leaves the model unknown when nothing names one", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_no_model" });
    log.start({ turnId: "turn_1", at: 100 });
    log.usage({
      turnId: "turn_1",
      at: 110,
      last: claudeUsage({ input: 1, output: 1 }),
      total: claudeUsage({ input: 1, output: 1 }),
    });
    await t.indexer.syncThread("thr_no_model", t.signal);

    expect(t.entries("thr_no_model").map((entry) => entry.model)).toEqual([
      null,
    ]);
  });
});

describe("reconcile", () => {
  it("queues new and changed threads, and marks threads that disappeared as deleted without dropping usage", async () => {
    const t = setup();
    const kept = threadRow({ id: "thr_kept", updatedAt: 1_000 });
    const gone = threadRow({ id: "thr_gone", updatedAt: 1_000 });
    t.fake.putThread(kept);
    t.fake.putThread(gone);
    t.fake.thread("thr_gone").turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 900,
      last: claudeUsage({ input: 7, output: 3 }),
      total: claudeUsage({ input: 7, output: 3 }),
    });

    await t.indexer.reconcile(t.signal);
    expect(t.indexer.status().pendingThreads).toBe(2);
    await t.indexer.drain(t.signal);

    await t.indexer.reconcile(t.signal);
    expect(t.indexer.status().pendingThreads).toBe(0);

    t.fake.putThread({ ...kept, updatedAt: 2_000 });
    t.fake.removeThread("thr_gone");
    await t.indexer.reconcile(t.signal);
    expect(t.indexer.status().pendingThreads).toBe(1);
    expect(t.store.thread("thr_gone")?.deleted).toBe(true);
    expect(t.entries("thr_gone")).toHaveLength(1);
    expect(t.indexer.rescan()).toBe(1);
  });

  it("runs until aborted and records when tracking began", async () => {
    const t = setup();
    const log = t.addThread({ id: "thr_run" });
    log.turn({
      turnId: "turn_1",
      model: "claude-opus-5",
      at: 1_000,
      last: claudeUsage({ input: 2, output: 2 }),
      total: claudeUsage({ input: 2, output: 2 }),
    });
    const controller = new AbortController();
    const running = t.indexer.run(controller.signal);
    for (
      let attempt = 0;
      attempt < 50 && t.entries("thr_run").length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controller.abort();
    await running;

    expect(t.entries("thr_run")).toHaveLength(1);
    expect(t.store.trackingSinceMs()).toBe(50_000);
    expect(t.store.lastIndexedAtMs()).toBe(50_000);
  });

  it("does not mark a live thread deleted when a deletion shifts the list mid-scan", async () => {
    const t = setup((fake) => ({
      threads: {
        ...fake.sdk.threads,
        async list(args) {
          if (args.offset > 0) fake.removeThread("thr_0000");
          return fake.sdk.threads.list(args);
        },
      },
    }));
    for (let index = 0; index < 600; index += 1) {
      t.addThread({ id: `thr_${String(index).padStart(4, "0")}` });
    }

    await t.indexer.reconcile(t.signal);

    expect(t.store.thread("thr_0500")?.deleted).toBe(false);
    expect(t.store.liveThreadIds()).toHaveLength(600);
  });

  it("keeps a missing thread when the lookup that would confirm its deletion fails", async () => {
    const t = setup((fake) => ({
      threads: {
        ...fake.sdk.threads,
        async get() {
          throw Object.assign(new Error("HTTP 503: Server busy"), {
            status: 503,
            code: null,
          });
        },
      },
    }));
    t.addThread({ id: "thr_unsure" });
    t.fake.removeThread("thr_unsure");

    await t.indexer.reconcile(t.signal);

    expect(t.store.thread("thr_unsure")?.deleted).toBe(false);
    expect(t.warnings).toEqual([
      "AI Hub could not check whether thread thr_unsure still exists: HTTP 503: Server busy",
    ]);
  });

  it.each(["list", "events"] as const)(
    "stops as soon as it is aborted while a %s request is in flight",
    async (hung) => {
      const requests: string[] = [];
      const t = setup((fake) => ({
        threads: {
          ...fake.sdk.threads,
          async list(args) {
            requests.push("list");
            return hung === "list"
              ? hangUntilAborted(args.signal)
              : fake.sdk.threads.list(args);
          },
          events: {
            async list(args) {
              requests.push("events");
              return hung === "events"
                ? hangUntilAborted(args.signal)
                : fake.sdk.threads.events.list(args);
            },
          },
        },
      }));
      t.addThread({ id: "thr_waiting" });
      const controller = new AbortController();
      const running = t.indexer.run(controller.signal);
      await waitUntil(() => requests.includes(hung));

      controller.abort();

      expect(await settlesWithin(running, 1_000)).toBe(true);
    },
  );
});
