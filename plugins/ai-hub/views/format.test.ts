import { describe, expect, it } from "vitest";
import {
  cacheHitRate,
  coverageSummary,
  describeDelta,
  formatBucket,
  formatCalendarDay,
  formatCompact,
  formatDuration,
  formatHourRange,
  formatInteger,
  formatPercent,
  formatRelativeTime,
  indexingProgress,
  shareOf,
  shortId,
} from "./format.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.UTC(2026, 9, 14, 18, 0, 0);

const coverage = {
  trackingSinceMs: Date.UTC(2026, 9, 1, 9, 0, 0),
  backfilledTokens: 80,
  indexedThreads: 10,
  pendingThreads: 0,
  scanning: false,
  lastIndexedAtMs: null,
};

describe("number formatting", () => {
  it("compacts token counts the way the axis and tiles show them", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(12_900)).toBe("12.9K");
    expect(formatCompact(1_250_000)).toBe("1.3M");
    expect(formatCompact(Number.NaN)).toBe("—");
  });

  it("groups integers", () => {
    expect(formatInteger(1_234_567.4)).toBe("1,234,567");
  });

  it("never rounds a sliver to 0% or a near-miss to 100%", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0.996)).toBe(">99%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.426)).toBe("43%");
  });

  it("has no share of an empty whole", () => {
    expect(shareOf(5, 0)).toBeNull();
    expect(shareOf(5, 20)).toBe(0.25);
  });
});

describe("cacheHitRate", () => {
  it("divides cache reads by all input, cached or not", () => {
    expect(
      cacheHitRate({
        inputTokens: 100,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
      }),
    ).toBe(0.8);
  });

  it("is unknown when nothing was read", () => {
    expect(
      cacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ).toBeNull();
  });
});

describe("describeDelta", () => {
  it("reports direction and size against the previous period", () => {
    expect(describeDelta(120, 100)).toEqual({ direction: "up", text: "20%" });
    expect(describeDelta(50, 100)).toEqual({ direction: "down", text: "50%" });
    expect(describeDelta(1001, 1000)).toEqual({
      direction: "flat",
      text: "No change",
    });
  });

  it("has nothing to compare against an empty period", () => {
    expect(describeDelta(10, 0)).toBeNull();
  });
});

describe("dates", () => {
  it("formats in the viewer's time zone, not UTC", () => {
    const lateUtc = Date.UTC(2026, 9, 14, 3, 0, 0);
    expect(formatBucket(lateUtc, "day", "UTC")).toBe("Wed, Oct 14");
    expect(formatBucket(lateUtc, "day", "America/Los_Angeles")).toBe(
      "Tue, Oct 13",
    );
    expect(formatBucket(lateUtc, "week", "UTC")).toBe("Week of Oct 14");
  });

  it("adds the year only outside the current one", () => {
    expect(formatCalendarDay(Date.UTC(2026, 0, 3), "UTC", NOW)).toBe("Jan 3");
    expect(formatCalendarDay(Date.UTC(2025, 11, 30), "UTC", NOW)).toBe(
      "Dec 30, 2025",
    );
  });

  it("describes recent activity relative to now", () => {
    const at = (ago: number) =>
      formatRelativeTime({ timestamp: NOW - ago, now: NOW, timeZone: "UTC" });
    expect(at(10_000)).toBe("just now");
    expect(at(5 * 60_000)).toBe("5m ago");
    expect(at(3 * HOUR_MS)).toBe("3h ago");
    expect(at(DAY_MS + HOUR_MS)).toBe("yesterday");
    expect(at(3 * DAY_MS)).toBe("3d ago");
    expect(at(15 * DAY_MS)).toBe("2w ago");
    expect(at(60 * DAY_MS)).toBe("Aug 15");
  });

  it("formats durations and hour ranges", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 05s");
    expect(formatDuration(3_840_000)).toBe("1h 04m");
    expect(formatHourRange(22, 2)).toBe("22:00–00:00");
  });

  it("shortens long ids from the end", () => {
    expect(shortId("turn_1")).toBe("turn_1");
    expect(shortId("turn_01JABCDEF123456")).toBe("…EF123456");
  });
});

describe("coverage", () => {
  it("names the tracking start and the estimated share", () => {
    expect(
      coverageSummary({
        coverage,
        totalTokens: 1000,
        timeZone: "UTC",
        nowMs: NOW,
      }),
    ).toBe("Tracking since Oct 1 · 8% estimated");
  });

  it("leaves out the estimate when nothing was backfilled", () => {
    expect(
      coverageSummary({
        coverage: { ...coverage, trackingSinceMs: null, backfilledTokens: 0 },
        totalTokens: 0,
        timeZone: "UTC",
        nowMs: NOW,
      }),
    ).toBe("Not tracking yet");
  });

  it("reports the sync queue only while it runs", () => {
    expect(indexingProgress(coverage)).toBeNull();
    expect(
      indexingProgress({
        ...coverage,
        scanning: true,
        indexedThreads: 1_000,
        pendingThreads: 1_000,
      }),
    ).toBe("Syncing 1,000 threads…");
    expect(
      indexingProgress({
        ...coverage,
        indexedThreads: 1_000,
        pendingThreads: 1,
      }),
    ).toBe("Syncing 1 thread…");
    expect(
      indexingProgress({
        ...coverage,
        scanning: true,
        indexedThreads: 0,
        pendingThreads: 0,
      }),
    ).toBe("Syncing threads…");
  });
});
