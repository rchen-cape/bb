import type { ActivityCell } from "../../src/contract.js";

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const HOUR_BLOCKS = [1, 2, 3, 4, 6] as const;
export type HourBlock = (typeof HOUR_BLOCKS)[number];

export interface ActivityMatrix {
  blockHours: HourBlock;
  columns: number;
  tokens: number[][];
  turns: number[][];
  max: number;
}

export function hourBlockFor(args: {
  width: number;
  labelWidth: number;
  gap: number;
  minCell: number;
}): HourBlock {
  const available = Math.max(0, args.width - args.labelWidth);
  for (const block of HOUR_BLOCKS) {
    const columns = 24 / block;
    const cell = (available - args.gap * (columns - 1)) / columns;
    if (cell >= args.minCell) return block;
  }
  return 6;
}

export function buildActivityMatrix(
  cells: readonly ActivityCell[],
  blockHours: HourBlock,
): ActivityMatrix {
  const columns = 24 / blockHours;
  const tokens = Array.from({ length: 7 }, () =>
    Array.from({ length: columns }, () => 0),
  );
  const turns = Array.from({ length: 7 }, () =>
    Array.from({ length: columns }, () => 0),
  );
  for (const cell of cells) {
    const column = Math.floor(cell.hour / blockHours);
    const tokenRow = tokens[cell.weekday];
    const turnRow = turns[cell.weekday];
    if (tokenRow === undefined || turnRow === undefined) continue;
    tokenRow[column] = (tokenRow[column] ?? 0) + cell.totalTokens;
    turnRow[column] = (turnRow[column] ?? 0) + cell.turns;
  }
  const max = Math.max(0, ...tokens.flat());
  return { blockHours, columns, tokens, turns, max };
}
