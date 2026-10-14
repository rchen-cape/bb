import type { BreakdownRow } from "../../src/contract.js";

export interface FoldedRows {
  visible: BreakdownRow[];
  other: (BreakdownRow & { count: number }) | null;
}

export function rankRows(rows: readonly BreakdownRow[]): BreakdownRow[] {
  return [...rows].sort(
    (a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label),
  );
}

export function foldRows(
  rows: readonly BreakdownRow[],
  limit: number,
): FoldedRows {
  const ranked = rankRows(rows);
  if (ranked.length <= limit + 1) return { visible: ranked, other: null };
  const visible = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  const other = rest.reduce<BreakdownRow & { count: number }>(
    (total, row) => ({
      ...total,
      inputTokens: total.inputTokens + row.inputTokens,
      cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      reasoningTokens: total.reasoningTokens + row.reasoningTokens,
      totalTokens: total.totalTokens + row.totalTokens,
      turns: total.turns + row.turns,
      threads: total.threads + row.threads,
      count: total.count + 1,
    }),
    {
      key: null,
      label: `Other (${rest.length})`,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      turns: 0,
      threads: 0,
      count: 0,
    },
  );
  return { visible, other };
}

export function assignSlots(args: {
  keys: readonly (string | null)[];
  stableOrder: readonly string[];
  slotCount: number;
}): Map<string, number> {
  const position = new Map(args.stableOrder.map((key, index) => [key, index]));
  const keys = [
    ...new Set(
      args.keys.filter((key): key is string => key !== null && key.length > 0),
    ),
  ].sort((a, b) => {
    const left = position.get(a);
    const right = position.get(b);
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return a.localeCompare(b);
  });
  const slots = new Map<string, number>();
  keys.slice(0, args.slotCount).forEach((key, index) => {
    slots.set(key, index);
  });
  return slots;
}
