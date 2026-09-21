import { getThread } from "@bb/db";
import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { applyTurnCompletedEvent } from "../../src/internal/turn-completed-events.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface CompleteTurnArgs {
  closingText: string | null;
  parentThreadId?: string | null;
  status?: "completed" | "failed";
  turnId?: string;
}

function seedActiveThread(
  harness: TestAppHarness,
  parentThreadId: string | null,
) {
  const host = seedHost(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  return seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
    ...(parentThreadId === null ? {} : { parentThreadId }),
  });
}

function completeTurn(
  harness: TestAppHarness,
  args: CompleteTurnArgs,
): boolean {
  const turnId = args.turnId ?? "turn-1";
  const thread = seedActiveThread(harness, args.parentThreadId ?? null);
  seedStoredEvent(harness.deps, {
    threadId: thread.id,
    scope: turnScope(turnId),
    sequence: 1,
    type: "turn/started",
    itemId: null,
    itemKind: null,
    data: { providerThreadId: "provider-thread-1" },
  });
  if (args.closingText !== null) {
    seedStoredEvent(harness.deps, {
      threadId: thread.id,
      scope: turnScope(turnId),
      sequence: 2,
      type: "item/completed",
      itemId: "msg-1",
      itemKind: "agentMessage",
      data: {
        item: { id: "msg-1", type: "agentMessage", text: args.closingText },
      },
    });
  }
  seedStoredEvent(harness.deps, {
    threadId: thread.id,
    scope: turnScope(turnId),
    sequence: 3,
    type: "turn/completed",
    itemId: null,
    itemKind: null,
    data: { status: args.status ?? "completed" },
  });

  applyTurnCompletedEvent(harness.deps, {
    type: "turn/completed",
    threadId: thread.id,
    providerThreadId: "provider-thread-1",
    scope: turnScope(turnId),
    status: args.status ?? "completed",
  });

  return getThread(harness.db, thread.id)?.awaitingUserReply ?? false;
}

describe("turn completion records whether the user was asked something", () => {
  it("flags a turn that closes on a question", async () => {
    await withTestHarness(async (harness) => {
      expect(
        completeTurn(harness, {
          closingText: "Want me to roll that into the same commit?",
        }),
      ).toBe(true);
    });
  });

  it("leaves a turn that closes on a finding unflagged", async () => {
    await withTestHarness(async (harness) => {
      expect(
        completeTurn(harness, {
          closingText: "Both suites pass and the flake is gone.",
        }),
      ).toBe(false);
    });
  });

  it("does not flag a child thread that asks its parent", async () => {
    await withTestHarness(async (harness) => {
      const parent = seedActiveThread(harness, null);
      expect(
        completeTurn(harness, {
          closingText: "Should I keep going?",
          parentThreadId: parent.id,
        }),
      ).toBe(false);
    });
  });

  it("does not flag a failed turn", async () => {
    await withTestHarness(async (harness) => {
      expect(
        completeTurn(harness, {
          closingText: "Should I retry?",
          status: "failed",
        }),
      ).toBe(false);
    });
  });

  it("settles a turn with no agent message at all", async () => {
    await withTestHarness(async (harness) => {
      expect(completeTurn(harness, { closingText: null })).toBe(false);
    });
  });
});
