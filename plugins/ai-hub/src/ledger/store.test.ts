import Database from "better-sqlite3";
import { runPluginStorageMigrations } from "@get-bb/plugin-sdk/internal/host-policy";
import { describe, expect, it } from "vitest";
import { openLedger, seedEntry, seedThread, tokens } from "../test-fixtures";
import { migrations, type LedgerEntry } from "./store";

const SHIPPED_HASHES = [
  "9eefc69944331c7f7d860f1fdd911ca1043c863af144cb2a891d16967d4e72da",
];

describe("migrations", () => {
  it("has not changed a statement that already shipped", () => {
    const db = new Database(":memory:");
    runPluginStorageMigrations(db, migrations.slice(0, SHIPPED_HASHES.length));
    const pin = db.prepare(
      "UPDATE _bb_migrations SET statement_hash = ? WHERE id = ?",
    );
    SHIPPED_HASHES.forEach((hash, index) => {
      pin.run(hash, index);
    });
    expect(() => runPluginStorageMigrations(db, migrations)).not.toThrow();
  });
});

describe("ledger store", () => {
  it("asks for a sync only when a thread changed since its last sync", () => {
    const { store } = openLedger();
    seedThread(store, { threadId: "thr_1", updatedAt: 10 });
    store.markSynced({ threadId: "thr_1", syncedUpdatedAt: 10, now: 99 });

    expect(
      store.upsertThread({
        threadId: "thr_1",
        projectId: "proj_app",
        providerId: "claude-code",
        parentThreadId: null,
        sourceThreadId: null,
        title: "Renamed",
        titleFallback: null,
        createdAt: 0,
        updatedAt: 10,
        archived: true,
        deleted: false,
      }).needsSync,
    ).toBe(false);
    expect(store.thread("thr_1")).toMatchObject({
      title: "Renamed",
      archived: true,
      lastSyncedAt: 99,
    });
    expect(store.lastIndexedAtMs()).toBe(99);
  });

  it("moves a thread's recorded usage when the thread moves to another project", () => {
    const { db, store, queries } = openLedger();
    seedThread(store, { threadId: "thr_1", projectId: "proj_app" });
    seedThread(store, { threadId: "thr_2", projectId: "proj_app" });
    seedEntry(store, {
      threadId: "thr_1",
      createdAt: 1,
      projectId: "proj_app",
      tokens: tokens({ input: 10 }),
    });
    seedEntry(store, {
      threadId: "thr_2",
      createdAt: 1,
      projectId: "proj_app",
      tokens: tokens({ input: 20 }),
    });

    seedThread(store, { threadId: "thr_1", projectId: "proj_docs" });

    expect(
      db
        .prepare(
          "SELECT thread_id AS threadId, project_id AS projectId FROM usage_entries ORDER BY thread_id",
        )
        .all(),
    ).toEqual([
      { threadId: "thr_1", projectId: "proj_docs" },
      { threadId: "thr_2", projectId: "proj_app" },
    ]);
    expect(queries.ledgerKeys("project").sort()).toEqual([
      "proj_app",
      "proj_docs",
    ]);
  });

  it("keeps the first tracking time", () => {
    const { store } = openLedger();
    store.ensureTrackingSince(5);
    store.ensureTrackingSince(9);
    expect(store.trackingSinceMs()).toBe(5);
  });

  it("ignores an entry id it already recorded", () => {
    const { store } = openLedger();
    const entry = {
      id: "evt_1",
      threadId: "thr_1",
      seq: 1,
      createdAt: 1,
      turnId: "turn_1",
      providerId: "claude-code",
      projectId: null,
      model: null,
      isSubagent: false,
      source: "live" as const,
      tokens: tokens({ input: 5 }),
    };
    expect(store.insertEntry(entry)).toBe(true);
    expect(
      store.insertEntry({ ...entry, tokens: tokens({ input: 500 }) }),
    ).toBe(false);
  });

  it("keeps only the newest context snapshot and subagent task value", () => {
    const { store, db } = openLedger();
    const snapshot = {
      threadId: "thr_1",
      createdAt: 1,
      model: "claude-opus-5",
      windowTokens: 200_000,
      categories: [],
    };
    store.upsertContextSnapshot({ ...snapshot, seq: 5, usedTokens: 50 });
    store.upsertContextSnapshot({ ...snapshot, seq: 3, usedTokens: 30 });
    const task = {
      threadId: "thr_1",
      itemId: "task_1",
      turnId: null,
      createdAt: 1,
      toolUses: 1,
      durationMs: 1,
    };
    store.upsertSubagentTask({ ...task, seq: 7, totalTokens: 700 });
    store.upsertSubagentTask({ ...task, seq: 6, totalTokens: 600 });

    expect(
      db.prepare("SELECT used_tokens AS used FROM context_snapshots").get(),
    ).toEqual({ used: 50 });
    expect(
      db.prepare("SELECT total_tokens AS total FROM subagent_tasks").get(),
    ).toEqual({ total: 700 });
  });
});

describe("first entry of each turn", () => {
  function flags(db: Database.Database) {
    return db
      .prepare<[], { id: string; first: number }>(
        "SELECT id, first_of_turn AS first FROM usage_entries ORDER BY id",
      )
      .all();
  }

  it("flags the earliest live entry of a turn, even when it is recorded last", () => {
    const { store, db } = openLedger();
    const entry = (
      id: string,
      createdAt: number,
      overrides: Partial<LedgerEntry> = {},
    ) =>
      store.insertEntry({
        id,
        threadId: "thr_1",
        seq: createdAt,
        createdAt,
        turnId: "turn_1",
        providerId: "codex",
        projectId: null,
        model: null,
        isSubagent: false,
        source: "live",
        tokens: tokens({ input: 1 }),
        ...overrides,
      });
    entry("evt_b", 20);
    entry("evt_c", 30);
    entry("evt_a", 10);
    entry("evt_a:gap", 5, { source: "backfill" });
    entry("evt_other_thread", 40, { threadId: "thr_2" });
    entry("evt_no_turn_1", 50, { turnId: null });
    entry("evt_no_turn_2", 60, { turnId: null });

    expect(flags(db)).toEqual([
      { id: "evt_a", first: 1 },
      { id: "evt_a:gap", first: 0 },
      { id: "evt_b", first: 0 },
      { id: "evt_c", first: 0 },
      { id: "evt_no_turn_1", first: 1 },
      { id: "evt_no_turn_2", first: 1 },
      { id: "evt_other_thread", first: 1 },
    ]);
  });

  it("flags entries recorded before the flag existed", () => {
    const db = new Database(":memory:");
    runPluginStorageMigrations(db, migrations.slice(0, 1));
    const insert = db.prepare<[string, string, number, string | null, string]>(
      `INSERT INTO usage_entries (
         id, thread_id, seq, created_at, turn_id, provider_id, is_subagent,
         source, input_tokens, cache_read_tokens, cache_write_tokens,
         output_tokens, reasoning_tokens, total_tokens
       ) VALUES (?, ?, 1, ?, ?, 'codex', 0, ?, 1, 0, 0, 0, 0, 1)`,
    );
    insert.run("evt_late", "thr_1", 20, "turn_1", "live");
    insert.run("evt_tie_b", "thr_1", 10, "turn_1", "live");
    insert.run("evt_tie_a", "thr_1", 10, "turn_1", "live");
    insert.run("evt_gap", "thr_1", 1, "turn_1", "backfill");
    insert.run("evt_same_turn_id", "thr_2", 30, "turn_1", "live");
    insert.run("evt_loose", "thr_1", 40, null, "live");

    runPluginStorageMigrations(db, migrations);

    expect(flags(db)).toEqual([
      { id: "evt_gap", first: 0 },
      { id: "evt_late", first: 0 },
      { id: "evt_loose", first: 1 },
      { id: "evt_same_turn_id", first: 1 },
      { id: "evt_tie_a", first: 1 },
      { id: "evt_tie_b", first: 0 },
    ]);
  });
});
