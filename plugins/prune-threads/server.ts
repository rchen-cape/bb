import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { pruneRpc } from "./lib/contract.js";
import { createService } from "./lib/service.js";

async function output(work: () => Promise<unknown>): Promise<PluginCliResult> {
  try {
    return {
      exitCode: 0,
      stdout: JSON.stringify(await work(), null, 2) + "\n",
    };
  } catch (error) {
    return {
      exitCode: 1,
      stderr: (error instanceof Error ? error.message : String(error)) + "\n",
    };
  }
}

const RECOUNT_DELAY_MS = 10_000;

export default function plugin(bb: BbPluginApi) {
  const service = createService(bb);
  const recount = () =>
    service
      .refresh()
      .then(() => undefined)
      .catch((error: unknown) =>
        bb.log.warn(`could not count prunable threads: ${String(error)}`),
      );
  let pending: ReturnType<typeof setTimeout> | null = null;
  const recountSoon = () => {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void recount();
    }, RECOUNT_DELAY_MS);
  };
  bb.onDispose(() => {
    if (pending !== null) clearTimeout(pending);
  });
  for (const event of [
    "thread.idle",
    "thread.archived",
    "thread.unarchived",
    "thread.deleted",
  ] as const)
    bb.events.on(event, recountSoon);
  bb.background.schedule("recount", "*/5 * * * *", recount);
  bb.rpc.register(pruneRpc, {
    status: () => service.status(),
    preview: () => service.preview(),
    prune: (input) => service.prune(input),
  });
  bb.cli.register(
    defineCli({
      name: "prune",
      summary:
        "Delete read, finished threads idle over 24 hours with nothing left to push (JSON output)",
      root: cliCommand({
        summary: "List threads that would be pruned; pass --yes to delete them",
        options: {
          yes: {
            type: "boolean",
            description: "Delete the listed threads",
          },
          keep: {
            type: "string",
            description:
              "Comma-separated root thread IDs from the list to keep instead of deleting",
          },
        },
        run: ({ options }) =>
          output(async () => {
            const preview = await service.preview();
            if (!options.yes) return preview;
            const keep = new Set(
              (options.keep ?? "")
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean),
            );
            return service.prune({
              rootIds: preview.groups
                .map((group) => group.rootId)
                .filter((rootId) => !keep.has(rootId)),
            });
          }),
      }),
      commands: {},
    }),
  );
}
