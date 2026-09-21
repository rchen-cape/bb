import { describe, expect, it } from "vitest";
import { closingPassageAsksUser } from "../../../src/services/threads/awaiting-user-reply.js";

describe("closingPassageAsksUser", () => {
  it.each([
    [
      "a direct question",
      "Is there a specific test scenario or environment you're setting up?",
    ],
    [
      "an offer to continue",
      "Want me to scan the existing aug2026 and sept2026 dailies for it?",
    ],
    [
      "a hand-back with no question mark",
      "I'd also rather not kill other running sessions. If you do want a specific session restarted, tell me which one and I'll confirm before touching it.",
    ],
    ["a deferral", "Both readings are defensible, so it's your call."],
  ])("reads %s as waiting on the user", (_label, text) => {
    expect(closingPassageAsksUser(text)).toBe(true);
  });

  it.each([
    [
      "a report that ends on a finding",
      "The expected table is what production code computes from those exact files.",
    ],
    [
      "a summary of completed work",
      "Fixed the off-by-one and added a regression test. Both suites pass.",
    ],
  ])("reads %s as finished", (_label, text) => {
    expect(closingPassageAsksUser(text)).toBe(false);
  });

  it("ignores a question answered earlier in the message", () => {
    const text = [
      "Why was it failing? The retry budget was exhausted before the first attempt.",
      "Raised the budget to three and pinned the backoff.",
    ].join("\n\n");

    expect(closingPassageAsksUser(text)).toBe(false);
  });

  it("does not read a trailing code block as a question", () => {
    const text = [
      "Here is the generated message.",
      "```proto\nmessage GetKeyRequest { string id = 1; } // which key?\n```",
    ].join("\n\n");

    expect(closingPassageAsksUser(text)).toBe(false);
  });

  it("ignores a question in an earlier bullet of the closing list", () => {
    const text = [
      "Reviewed the migration:",
      "- Should the token id be BIGINT? Yes, and it doubles as the FK index.",
      "- Regenerate sqlc after this, and the schema test output will change.",
    ].join("\n");

    expect(closingPassageAsksUser(text)).toBe(false);
  });

  it("reads a question on the closing line of a list", () => {
    const text = [
      "Reviewed the migration:",
      "- Schema-qualified throughout, and IF NOT EXISTS matches 0003.",
      "- Want me to regenerate sqlc and refresh the schema test output?",
    ].join("\n");

    expect(closingPassageAsksUser(text)).toBe(true);
  });

  it("reads the closing prose of a long report", () => {
    const text = [
      "## Ingested (19 records)",
      "All on your line, spread over two days.",
      "Should I widen the window to a full week?",
    ].join("\n\n");

    expect(closingPassageAsksUser(text)).toBe(true);
  });
});
