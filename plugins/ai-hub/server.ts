import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createAiHubCli } from "./src/cli.js";
import { aiHubRpcContract, USAGE_REALTIME_CHANNEL } from "./src/contract.js";
import { createSdkLabelSource } from "./src/labels.js";
import { createIndexer } from "./src/ledger/indexer.js";
import { createLedgerQueries } from "./src/ledger/queries.js";
import { createLedgerStore, migrations } from "./src/ledger/store.js";
import { createReporter, type UsageApi } from "./src/report.js";
import { localTimeZone } from "./src/time.js";

export { aiHubRpcContract } from "./src/contract.js";

const PUBLISH_INTERVAL_MS = 2_000;

function createThrottledPublisher(publish: () => void) {
  let lastPublishedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    notify(): void {
      if (timer !== null) return;
      const waitMs = lastPublishedAt + PUBLISH_INTERVAL_MS - Date.now();
      timer = setTimeout(
        () => {
          timer = null;
          lastPublishedAt = Date.now();
          publish();
        },
        Math.max(0, waitMs),
      );
    },
    dispose(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const store = createLedgerStore(db);
  const queries = createLedgerQueries(db);

  const publisher = createThrottledPublisher(() => {
    bb.realtime.publish(USAGE_REALTIME_CHANNEL, { type: "invalidated" });
  });
  bb.onDispose(() => publisher.dispose());

  const indexer = createIndexer({
    sdk: () => bb.sdk,
    store,
    log: bb.log,
    onChange: () => publisher.notify(),
    now: Date.now,
  });
  const reporter = createReporter({
    store,
    queries,
    labels: createSdkLabelSource({
      sdk: () => bb.sdk,
      log: bb.log,
      now: Date.now,
    }),
    indexer,
    now: Date.now,
  });
  const api: UsageApi = {
    report: reporter.report,
    threadUsage: reporter.threadUsage,
    status: reporter.coverage,
    rescan: () => ({ queuedThreads: indexer.rescan() }),
  };

  bb.rpc.register(aiHubRpcContract, {
    report: (filters) => api.report(filters),
    threadUsage: ({ threadId }) => api.threadUsage(threadId),
    status: () => api.status(),
    rescan: () => api.rescan(),
  });

  bb.cli.register(createAiHubCli({ api, timeZone: localTimeZone }));

  bb.events.on("experimental_thread.events", ({ thread }) => {
    indexer.noteThread(thread, { sync: true });
  });
  bb.events.on("thread.idle", ({ thread }) => {
    indexer.noteThread(thread, { sync: true });
  });
  bb.events.on("thread.archived", ({ thread }) => {
    indexer.noteThread(thread, { sync: false });
  });
  bb.events.on("thread.unarchived", ({ thread }) => {
    indexer.noteThread(thread, { sync: false });
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    indexer.markDeleted(thread.id);
  });

  bb.background.service("usage-indexer", {
    start: (signal) => indexer.run(signal),
  });
}
