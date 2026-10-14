import { describe, expect, it } from "vitest";
import type { BreakdownRow } from "../../src/contract.js";
import { assignSlots, foldRows } from "./fold.js";

function row(key: string | null, totalTokens: number): BreakdownRow {
  return {
    key,
    label: key ?? "None",
    inputTokens: totalTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    turns: 1,
    threads: 1,
  };
}

describe("foldRows", () => {
  it("ranks by tokens and keeps short lists whole", () => {
    const folded = foldRows([row("a", 1), row("b", 3), row("c", 2)], 7);
    expect(folded.visible.map((entry) => entry.key)).toEqual(["b", "c", "a"]);
    expect(folded.other).toBeNull();
  });

  it("does not fold a single leftover row", () => {
    const rows = Array.from({ length: 8 }, (_, index) => row(`m${index}`, 10));
    expect(foldRows(rows, 7).other).toBeNull();
  });

  it("folds the tail into Other and sums it", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row(`m${index}`, 100 - index),
    );
    const folded = foldRows(rows, 7);
    expect(folded.visible).toHaveLength(7);
    expect(folded.other).toMatchObject({
      key: null,
      label: "Other (3)",
      totalTokens: 93 + 92 + 91,
      turns: 3,
      count: 3,
    });
  });
});

describe("assignSlots", () => {
  it("colors by entity, not by rank", () => {
    const stableOrder = ["claude-code", "codex", "pi"];
    const first = assignSlots({
      keys: ["codex", "claude-code"],
      stableOrder,
      slotCount: 8,
    });
    const reranked = assignSlots({
      keys: ["claude-code", "codex"],
      stableOrder,
      slotCount: 8,
    });
    expect(first).toEqual(reranked);
    expect(first.get("claude-code")).toBe(0);
    expect(first.get("codex")).toBe(1);
  });

  it("orders unknown keys alphabetically after known ones and skips nulls", () => {
    const slots = assignSlots({
      keys: ["zeta", null, "alpha", "codex"],
      stableOrder: ["codex"],
      slotCount: 8,
    });
    expect([...slots.entries()]).toEqual([
      ["codex", 0],
      ["alpha", 1],
      ["zeta", 2],
    ]);
  });

  it("never hands out more slots than the palette has", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `k${index}`);
    expect(assignSlots({ keys, stableOrder: [], slotCount: 8 }).size).toBe(8);
  });
});
