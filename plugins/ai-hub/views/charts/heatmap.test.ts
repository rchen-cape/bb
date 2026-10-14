import { describe, expect, it } from "vitest";
import { buildActivityMatrix, hourBlockFor } from "./heatmap.js";
import { chartPalette, sequentialColor } from "./palette.js";

describe("hourBlockFor", () => {
  const args = { labelWidth: 34, gap: 2, minCell: 24 };

  it("shows every hour when cells stay at least 24px wide", () => {
    expect(hourBlockFor({ ...args, width: 700 })).toBe(1);
  });

  it("merges hours on narrow panels instead of shrinking the hit area", () => {
    expect(hourBlockFor({ ...args, width: 360 })).toBe(2);
    expect(hourBlockFor({ ...args, width: 200 })).toBe(4);
  });
});

describe("buildActivityMatrix", () => {
  it("sums cells into hour blocks per weekday", () => {
    const matrix = buildActivityMatrix(
      [
        { weekday: 1, hour: 9, totalTokens: 100, turns: 2 },
        { weekday: 1, hour: 10, totalTokens: 50, turns: 1 },
        { weekday: 0, hour: 23, totalTokens: 10, turns: 1 },
      ],
      2,
    );
    expect(matrix.columns).toBe(12);
    expect(matrix.tokens[1]?.[4]).toBe(100);
    expect(matrix.tokens[1]?.[5]).toBe(50);
    expect(matrix.turns[0]?.[11]).toBe(1);
    expect(matrix.max).toBe(100);
  });
});

describe("palette", () => {
  it("steps the sequential ramp by magnitude and leaves zero empty", () => {
    const light = chartPalette("light");
    expect(sequentialColor(light, 0, 100)).toBeNull();
    expect(sequentialColor(light, 1, 100)).toBe("#cde2fb");
    expect(sequentialColor(light, 100, 100)).toBe("#0d366b");
  });

  it("uses separately stepped colors in dark mode", () => {
    expect(chartPalette("light").tokens.inputTokens).toBe("#2a78d6");
    expect(chartPalette("dark").tokens.inputTokens).toBe("#3987e5");
    expect(chartPalette("dark").sequential[0]).not.toBe("#cde2fb");
  });
});
