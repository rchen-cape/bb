import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server";
import { threadDetailSchema, usageReportSchema } from "./src/contract";
import { claudeUsage, createFakeThreadsSdk } from "./src/test-fixtures";

async function eventually(check: () => Promise<boolean> | boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition never became true");
}

function hangUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function setup(options: { hangEventReads?: boolean } = {}) {
  const events = createFakeThreadsSdk();
  let eventReads = 0;
  const thread = makeThreadResponse({
    id: "thr_live",
    providerId: "claude-code",
    projectId: "proj_app",
    title: "Live thread",
    createdAt: Date.UTC(2026, 9, 1),
    updatedAt: Date.UTC(2026, 9, 2),
  });
  events.thread("thr_live").turn({
    turnId: "turn_1",
    model: "claude-opus-5",
    at: Date.now() - 60_000,
    last: claudeUsage({ input: 40, cacheRead: 900, output: 60 }),
    total: claudeUsage({ input: 40, cacheRead: 900, output: 60 }),
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb--ai-hub",
    sdk: {
      threads: {
        list: async ({ offset } = {}) => ((offset ?? 0) === 0 ? [thread] : []),
        events: {
          list: (args) => {
            eventReads += 1;
            return options.hangEventReads
              ? hangUntilAborted(args.signal)
              : events.listEvents(args);
          },
        },
      },
      projects: { list: async () => [{ id: "proj_app", name: "App" }] },
      providers: {
        list: async () => [{ id: "claude-code", displayName: "Claude Code" }],
        models: async () => ({
          models: [
            {
              id: "claude-opus-5",
              model: "claude-opus-5",
              displayName: "Claude Opus 5",
            },
          ],
        }),
      },
    },
  });
  plugin(bb);
  return { harness, thread, eventReads: () => eventReads };
}

describe("AI Hub server", () => {
  it("indexes threads in the background and serves reports over rpc", async () => {
    const { harness } = setup();
    const service = harness.behavior.runService("usage-indexer");
    await eventually(() => harness.inspection.realtimeSignals.length > 0);

    const report = usageReportSchema.parse(
      await harness.behavior.callRpc("report", {
        range: "7d",
        projectId: null,
        providerId: null,
        timeZone: "America/New_York",
      }),
    );
    expect(report.totals).toMatchObject({
      totalTokens: 1_000,
      cacheReadTokens: 900,
      turns: 1,
      threads: 1,
    });
    expect(report.byModel.map((row) => row.label)).toEqual(["Claude Opus 5"]);
    expect(report.byProvider.map((row) => row.label)).toEqual(["Claude Code"]);
    expect(report.topThreads[0]).toMatchObject({
      threadId: "thr_live",
      title: "Live thread",
      projectName: "App",
    });
    expect(harness.inspection.realtimeSignals[0]).toMatchObject({
      channel: "usage",
      payload: { type: "invalidated" },
    });

    service.controller.abort();
    await service.done;
    await harness.lifecycle.dispose();
  });

  it("keeps a deleted thread's usage and marks it deleted", async () => {
    const { harness, thread } = setup();
    const service = harness.behavior.runService("usage-indexer");
    await eventually(() => harness.inspection.realtimeSignals.length > 0);

    await harness.behavior.emitThreadEvent("thread.deleted", { thread });
    const detail = threadDetailSchema
      .nullable()
      .parse(
        await harness.behavior.callRpc("threadUsage", { threadId: "thr_live" }),
      );
    expect(detail?.thread).toMatchObject({ deleted: true, totalTokens: 1_000 });
    expect(
      await harness.behavior.callRpc("threadUsage", { threadId: "thr_none" }),
    ).toBeNull();

    service.controller.abort();
    await service.done;
    await harness.lifecycle.dispose();
  });

  it("stops the indexer service promptly when stopped mid-request", async () => {
    const { harness, eventReads } = setup({ hangEventReads: true });
    const service = harness.behavior.runService("usage-indexer");
    await eventually(() => eventReads() > 0);

    service.controller.abort();
    let stopped = false;
    void service.done.then(() => {
      stopped = true;
    });
    await eventually(() => stopped);
    await harness.lifecycle.dispose();
  });

  it("rejects a report for an unknown time zone", async () => {
    const { harness } = setup();
    await expect(
      harness.behavior.callRpc("report", {
        range: "30d",
        projectId: null,
        providerId: null,
        timeZone: "Not/A_Zone",
      }),
    ).rejects.toThrow('Unknown time zone "Not/A_Zone".');
    await harness.lifecycle.dispose();
  });

  it("answers status and rescan from the cli and rpc", async () => {
    const { harness, thread } = setup();
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: null,
    });

    expect(await harness.behavior.callRpc("rescan", null)).toEqual({
      queuedThreads: 1,
    });
    const status = await harness.behavior.runCli(["status", "--json"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      indexedThreads: 0,
      pendingThreads: 1,
      scanning: true,
    });
    await harness.lifecycle.dispose();
  });
});
