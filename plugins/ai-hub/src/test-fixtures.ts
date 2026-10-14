import Database from "better-sqlite3";
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { runPluginStorageMigrations } from "@get-bb/plugin-sdk/internal/host-policy";
import type { EntrySource } from "./contract.js";
import { createLabels, type LabelSource } from "./labels.js";
import type {
  EventRowInput,
  IndexerSdk,
  ThreadInput,
} from "./ledger/indexer.js";
import type { LedgerTokens, TokenBreakdown } from "./ledger/normalize.js";
import { createLedgerQueries } from "./ledger/queries.js";
import {
  createLedgerStore,
  migrations,
  type LedgerStore,
  type ThreadMeta,
} from "./ledger/store.js";

export function openLedger() {
  const db = new Database(":memory:");
  runPluginStorageMigrations(db, migrations);
  return {
    db,
    store: createLedgerStore(db),
    queries: createLedgerQueries(db),
  };
}

export function recordingLog() {
  const warnings: string[] = [];
  const log: PluginLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: (message) => {
      warnings.push(message);
    },
  };
  return { log, warnings };
}

export function claudeUsage(tokens: {
  input: number;
  cacheRead?: number;
  cacheWrite?: number;
  output: number;
}): TokenBreakdown {
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  return {
    totalTokens: tokens.input + cacheRead + cacheWrite + tokens.output,
    inputTokens: tokens.input,
    cachedInputTokens: cacheRead + cacheWrite,
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: tokens.output,
    reasoningOutputTokens: 0,
  };
}

export function codexUsage(tokens: {
  input: number;
  cached?: number;
  output: number;
  reasoning?: number;
}): TokenBreakdown {
  const cached = tokens.cached ?? 0;
  return {
    totalTokens: tokens.input + tokens.output,
    inputTokens: tokens.input,
    cachedInputTokens: cached,
    cacheReadInputTokens: cached,
    outputTokens: tokens.output,
    reasoningOutputTokens: tokens.reasoning ?? 0,
  };
}

export function threadRow(
  overrides: Partial<ThreadInput> & { id: string },
): ThreadInput {
  return {
    title: `Thread ${overrides.id}`,
    titleFallback: null,
    projectId: "proj_app",
    providerId: "claude-code",
    parentThreadId: null,
    sourceThreadId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

interface FakeEventLog {
  rows: EventRowInput[];
  nextSeq: number;
}

export function createFakeThreadsSdk() {
  const threads = new Map<string, ThreadInput>();
  const logs = new Map<string, FakeEventLog>();
  const failures = new Map<string, Error>();
  const pageCaps = new Map<string, number>();
  const eventListCalls: { threadId: string; afterSeq: string | undefined }[] =
    [];

  function logFor(threadId: string): FakeEventLog {
    const existing = logs.get(threadId);
    if (existing !== undefined) return existing;
    const created: FakeEventLog = { rows: [], nextSeq: 1 };
    logs.set(threadId, created);
    return created;
  }

  async function listEvents(args: {
    threadId: string;
    types?: readonly string[];
    afterSeq?: string;
    limit?: string;
    order?: "asc" | "desc";
  }): Promise<EventRowInput[]> {
    const { threadId, types, afterSeq, limit, order } = args;
    eventListCalls.push({ threadId, afterSeq });
    const failure = failures.get(threadId);
    if (failure !== undefined) throw failure;
    if (types === undefined) throw new Error("types are required");
    if (order !== "asc") throw new Error("only asc is supported");
    if (limit === undefined || !/^\d+$/.test(limit) || Number(limit) > 100) {
      throw new Error(`invalid limit ${limit}`);
    }
    if (afterSeq !== undefined && !/^\d+$/.test(afterSeq)) {
      throw new Error(`invalid afterSeq ${afterSeq}`);
    }
    const cap = pageCaps.get(threadId);
    if (cap !== undefined && Number(limit) > cap) {
      throw new Error("event_data_too_large");
    }
    const wanted = new Set<string>(types);
    const after = afterSeq === undefined ? -1 : Number(afterSeq);
    return logFor(threadId)
      .rows.filter((row) => wanted.has(row.type) && row.seq > after)
      .sort((left, right) => left.seq - right.seq)
      .slice(0, Number(limit));
  }

  const sdk: IndexerSdk = {
    threads: {
      async list({ limit, offset }) {
        return [...threads.values()].slice(offset, offset + limit);
      },
      async get({ threadId }) {
        const row = threads.get(threadId);
        if (row === undefined) {
          throw Object.assign(new Error("HTTP 404: Thread not found"), {
            status: 404,
            code: "thread_not_found",
          });
        }
        return row;
      },
      events: { list: listEvents },
    },
  };

  function append(
    threadId: string,
    event: {
      type: string;
      createdAt: number;
      turnId?: string | null;
      data: unknown;
      id?: string;
    },
  ): string {
    const log = logFor(threadId);
    const seq = log.nextSeq;
    log.nextSeq += 1;
    const id = event.id ?? `${threadId}:evt${seq}`;
    log.rows.push({
      id,
      seq,
      createdAt: event.createdAt,
      type: event.type,
      scope:
        event.turnId === undefined || event.turnId === null
          ? { kind: "thread" }
          : { kind: "turn", turnId: event.turnId },
      data: event.data,
    });
    return id;
  }

  function thread(threadId: string, providerThreadId = `pt_${threadId}`) {
    const log = {
      skipSeq(count: number): void {
        logFor(threadId).nextSeq += count;
      },
      request(args: { requestId: string; model: string; at: number }): string {
        return append(threadId, {
          type: "client/turn/requested",
          createdAt: args.at,
          data: {
            requestId: args.requestId,
            execution: { model: args.model },
          },
        });
      },
      start(args: {
        turnId: string;
        at: number;
        parentToolCallId?: string;
        requestId?: string;
      }): void {
        append(threadId, {
          type: "turn/started",
          createdAt: args.at,
          turnId: args.turnId,
          data: {
            providerThreadId,
            ...(args.parentToolCallId === undefined
              ? {}
              : { parentToolCallId: args.parentToolCallId }),
          },
        });
        if (args.requestId !== undefined) {
          append(threadId, {
            type: "turn/input/accepted",
            createdAt: args.at,
            turnId: args.turnId,
            data: { providerThreadId, clientRequestId: args.requestId },
          });
        }
      },
      usage(args: {
        turnId: string;
        at: number;
        total: TokenBreakdown;
        last: TokenBreakdown;
        providerThreadId?: string;
      }): string {
        return append(threadId, {
          type: "thread/tokenUsage/updated",
          createdAt: args.at,
          turnId: args.turnId,
          data: {
            providerThreadId: args.providerThreadId ?? providerThreadId,
            tokenUsage: {
              total: args.total,
              last: args.last,
              modelContextWindow: null,
            },
          },
        });
      },
      turn(args: {
        turnId: string;
        model: string;
        at: number;
        total: TokenBreakdown;
        last: TokenBreakdown;
        providerThreadId?: string;
      }): string {
        const requestId = `req_${args.turnId}`;
        log.request({ requestId, model: args.model, at: args.at });
        log.start({ turnId: args.turnId, at: args.at, requestId });
        return log.usage(args);
      },
      fallback(args: {
        turnId: string | null;
        model: string;
        at: number;
      }): string {
        return append(threadId, {
          type: "provider/modelFallback",
          createdAt: args.at,
          turnId: args.turnId,
          data: {
            providerThreadId,
            originalModel: "original",
            fallbackModel: args.model,
            reason: "provider",
            message: "fell back",
          },
        });
      },
      backgroundTask(args: {
        itemId: string;
        at: number;
        totalTokens: number;
        toolUses: number;
        durationMs: number;
      }): string {
        return append(threadId, {
          type: "item/backgroundTask/completed",
          createdAt: args.at,
          data: {
            providerThreadId,
            item: {
              type: "backgroundTask",
              id: args.itemId,
              usage: {
                totalTokens: args.totalTokens,
                toolUses: args.toolUses,
                durationMs: args.durationMs,
              },
            },
          },
        });
      },
      context(args: {
        at: number;
        model: string;
        usedTokens: number;
        windowTokens: number;
        categories: {
          label: string;
          kind: string;
          tokens: number;
          entries?: { label: string; tokens: number }[];
        }[];
      }): string {
        return append(threadId, {
          type: "thread/contextWindowUsage/updated",
          createdAt: args.at,
          data: {
            providerThreadId,
            contextWindowUsage: {
              usedTokens: args.usedTokens,
              modelContextWindow: args.windowTokens,
              estimated: false,
              snapshot: {
                capturedAt: new Date(args.at).toISOString(),
                providerSessionId: "session",
                providerTurnId: null,
                model: args.model,
                usedTokens: args.usedTokens,
                contextWindowTokens: args.windowTokens,
                autoCompactAtTokens: null,
                estimated: false,
                categories: args.categories.map((category, index) => ({
                  id: `cat_${index}`,
                  label: category.label,
                  kind: category.kind,
                  tokens: category.tokens,
                  entries: (category.entries ?? []).map((entry, offset) => ({
                    id: `entry_${index}_${offset}`,
                    ...entry,
                  })),
                })),
              },
            },
          },
        });
      },
      prune(eventIds: readonly string[]): void {
        const doomed = new Set(eventIds);
        const events = logFor(threadId);
        events.rows = events.rows.filter((row) => !doomed.has(row.id));
      },
    };
    return log;
  }

  return {
    sdk,
    listEvents,
    eventListCalls,
    putThread(row: ThreadInput): void {
      threads.set(row.id, row);
    },
    removeThread(threadId: string): void {
      threads.delete(threadId);
    },
    capPageSize(threadId: string, size: number): void {
      pageCaps.set(threadId, size);
    },
    failEvents(threadId: string, error: Error | null): void {
      if (error === null) failures.delete(threadId);
      else failures.set(threadId, error);
    },
    thread,
  };
}

export function tokens(values: Partial<LedgerTokens>): LedgerTokens {
  const input = values.input ?? 0;
  const cacheRead = values.cacheRead ?? 0;
  const cacheWrite = values.cacheWrite ?? 0;
  const output = values.output ?? 0;
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    reasoning: values.reasoning ?? 0,
    total: input + cacheRead + cacheWrite + output,
  };
}

export function seedThread(
  store: LedgerStore,
  overrides: Partial<ThreadMeta> & { threadId: string },
): void {
  store.upsertThread({
    projectId: "proj_app",
    providerId: "claude-code",
    parentThreadId: null,
    sourceThreadId: null,
    title: `Thread ${overrides.threadId}`,
    titleFallback: null,
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    deleted: false,
    ...overrides,
  });
}

let seededEntries = 0;

export function seedEntry(
  store: LedgerStore,
  entry: {
    threadId: string;
    createdAt: number;
    tokens: LedgerTokens;
    turnId?: string | null;
    model?: string | null;
    providerId?: string;
    projectId?: string | null;
    source?: EntrySource;
    isSubagent?: boolean;
    id?: string;
  },
): string {
  seededEntries += 1;
  const id = entry.id ?? `seed_${seededEntries}`;
  store.insertEntry({
    id,
    threadId: entry.threadId,
    seq: seededEntries,
    createdAt: entry.createdAt,
    turnId: entry.turnId === undefined ? `turn_${id}` : entry.turnId,
    providerId: entry.providerId ?? "claude-code",
    projectId: entry.projectId === undefined ? "proj_app" : entry.projectId,
    model: entry.model === undefined ? "claude-opus-5" : entry.model,
    isSubagent: entry.isSubagent ?? false,
    source: entry.source ?? "live",
    tokens: entry.tokens,
  });
  return id;
}

export function staticLabels(): LabelSource {
  return {
    resolve: async () =>
      createLabels({
        projects: new Map([
          ["proj_app", "App"],
          ["proj_docs", "Docs"],
        ]),
        providers: new Map([
          ["claude-code", "Claude Code"],
          ["codex", "Codex"],
        ]),
        models: new Map([
          ["claude-opus-5", "Claude Opus 5"],
          ["gpt-5.5-codex", "GPT-5.5 Codex"],
        ]),
      }),
  };
}
