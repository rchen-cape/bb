import { describe, expect, it } from "vitest";
import {
  bandLayout,
  chunkFromEnd,
  niceStep,
  niceTicks,
  roundedTopRectPath,
  stackSegments,
  thinTickIndices,
} from "./scale.js";

describe("niceTicks", () => {
  it("rounds the axis to clean steps that cover the maximum", () => {
    expect(niceTicks(1_234_567)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
    expect(niceTicks(80)).toEqual([0, 20, 40, 60, 80]);
  });

  it("keeps integer steps for small counts", () => {
    expect(niceStep(0.3)).toBe(1);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  });

  it("draws only a baseline when there is no data", () => {
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe("thinTickIndices", () => {
  it("keeps every label when they fit", () => {
    expect(thinTickIndices(4, 10)).toEqual([0, 1, 2, 3]);
  });

  it("thins from the newest bucket so it is always labelled", () => {
    expect(thinTickIndices(30, 5)).toEqual([5, 11, 17, 23, 29]);
  });

  it("handles an empty series", () => {
    expect(thinTickIndices(0, 5)).toEqual([]);
  });
});

describe("bandLayout", () => {
  it("caps bar thickness at 24px and centers it in its band", () => {
    const layout = bandLayout({ count: 4, width: 400 });
    expect(layout.barWidth).toBe(24);
    expect(layout.barX(0)).toBe(38);
    expect(layout.center(1)).toBe(150);
  });

  it("leaves a 2px gap between thin touching bars", () => {
    const layout = bandLayout({ count: 90, width: 360 });
    expect(layout.barWidth).toBe(2);
  });

  it("snaps a pointer to the nearest band, clamped to the series", () => {
    const layout = bandLayout({ count: 10, width: 100 });
    expect(layout.indexAt(35)).toBe(3);
    expect(layout.indexAt(-5)).toBe(0);
    expect(layout.indexAt(500)).toBe(9);
  });
});

describe("stackSegments", () => {
  it("stacks from the baseline with a gap between segments", () => {
    expect(stackSegments([10, 0, 20], 2, 2)).toEqual([
      { seriesIndex: 0, start: 0, size: 20 },
      { seriesIndex: 2, start: 22, size: 38 },
    ]);
  });

  it("keeps the total height proportional", () => {
    const segments = stackSegments([5, 5, 5], 1, 2);
    const last = segments[segments.length - 1];
    expect(last === undefined ? 0 : last.start + last.size).toBe(15);
  });
});

describe("roundedTopRectPath", () => {
  it("never rounds more than the bar can hold", () => {
    expect(
      roundedTopRectPath({ x: 0, y: 0, width: 2, height: 10, radius: 4 }),
    ).toBe("M0,10 L0,1 A1,1 0 0 1 1,0 L1,0 A1,1 0 0 1 2,1 L2,10 Z");
  });
});

describe("chunkFromEnd", () => {
  it("passes short series through", () => {
    expect(chunkFromEnd([1, 2, 3], 12)).toEqual([[1], [2], [3]]);
  });

  it("groups from the newest point and drops a partial oldest group", () => {
    const values = Array.from({ length: 31 }, (_, index) => index);
    const chunks = chunkFromEnd(values, 12);
    expect(chunks).toHaveLength(10);
    expect(chunks[chunks.length - 1]).toEqual([28, 29, 30]);
    expect(chunks[0]).toEqual([1, 2, 3]);
  });
});
