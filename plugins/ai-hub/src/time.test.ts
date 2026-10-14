import { describe, expect, it } from "vitest";
import {
  addDays,
  createZonedClock,
  dateKey,
  formatLocalDateTime,
  InvalidTimeZoneError,
  rangeStartMs,
  weekStart,
} from "./time";

describe("createZonedClock", () => {
  it("rejects a time zone Intl does not know", () => {
    expect(() => createZonedClock("Mars/Olympus_Mons")).toThrow(
      InvalidTimeZoneError,
    );
  });

  it("finds local midnight on both sides of New York's DST changes", () => {
    const clock = createZonedClock("America/New_York");
    expect(clock.dayStart({ year: 2026, month: 3, day: 8 })).toBe(
      Date.UTC(2026, 2, 8, 5),
    );
    expect(clock.dayStart({ year: 2026, month: 3, day: 9 })).toBe(
      Date.UTC(2026, 2, 9, 4),
    );
    expect(clock.dayStart({ year: 2026, month: 11, day: 1 })).toBe(
      Date.UTC(2026, 10, 1, 4),
    );
    expect(clock.dayStart({ year: 2026, month: 11, day: 2 })).toBe(
      Date.UTC(2026, 10, 2, 5),
    );
  });

  it("starts every day at the first instant carrying that date", () => {
    for (const timeZone of [
      "America/New_York",
      "America/Santiago",
      "Asia/Kolkata",
      "Australia/Lord_Howe",
      "Pacific/Chatham",
    ]) {
      const clock = createZonedClock(timeZone);
      for (let offset = 0; offset < 366; offset += 1) {
        const date = addDays({ year: 2026, month: 1, day: 1 }, offset);
        const start = clock.dayStart(date);
        expect(dateKey(clock.parts(start))).toBe(dateKey(date));
        expect(dateKey(clock.parts(start - 60_000))).toBe(
          dateKey(addDays(date, -1)),
        );
      }
    }
  });

  it("reads weekday and hour in a half-hour offset zone", () => {
    const clock = createZonedClock("Asia/Kolkata");
    expect(clock.parts(Date.UTC(2026, 9, 13, 20))).toMatchObject({
      year: 2026,
      month: 10,
      day: 14,
      hour: 1,
      minute: 30,
      weekday: 3,
    });
    expect(clock.parts(Date.UTC(2026, 9, 13, 18, 15))).toMatchObject({
      day: 13,
      hour: 23,
      weekday: 2,
    });
  });
});

describe("calendar helpers", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart({ year: 2026, month: 10, day: 14 })).toEqual({
      year: 2026,
      month: 10,
      day: 12,
    });
    expect(weekStart({ year: 2026, month: 10, day: 18 })).toEqual({
      year: 2026,
      month: 10,
      day: 12,
    });
    expect(weekStart({ year: 2026, month: 10, day: 12 })).toEqual({
      year: 2026,
      month: 10,
      day: 12,
    });
  });

  it("starts a preset range at local midnight of its first day", () => {
    const clock = createZonedClock("America/New_York");
    const now = Date.UTC(2026, 10, 3, 17);
    expect(rangeStartMs({ range: "7d", now, clock })).toBe(
      Date.UTC(2026, 9, 28, 4),
    );
    expect(rangeStartMs({ range: "all", now, clock })).toBeNull();
  });

  it("formats a local date and time", () => {
    const clock = createZonedClock("Asia/Kolkata");
    expect(formatLocalDateTime(clock, Date.UTC(2026, 9, 13, 20, 5))).toBe(
      "2026-10-14 01:35",
    );
  });
});
