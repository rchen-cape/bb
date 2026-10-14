import type { RangePreset } from "./contract.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalParts extends LocalDate {
  hour: number;
  minute: number;
  weekday: number;
}

export interface ZonedClock {
  timeZone: string;
  parts(ms: number): LocalParts;
  dayStart(date: LocalDate): number;
}

export class InvalidTimeZoneError extends Error {}

export const RANGE_DAYS: Record<Exclude<RangePreset, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function dateKey(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

function calendarMs(date: LocalDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromCalendarMs(ms: number): LocalDate {
  const value = new Date(ms);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromCalendarMs(calendarMs(date) + days * DAY_MS);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((calendarMs(to) - calendarMs(from)) / DAY_MS);
}

export function weekdayOf(date: LocalDate): number {
  return new Date(calendarMs(date)).getUTCDay();
}

export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

function sameDate(left: LocalDate, right: LocalDate): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}

export function createZonedClock(timeZone: string): ZonedClock {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    throw new InvalidTimeZoneError(`Unknown time zone "${timeZone}".`);
  }

  function parts(ms: number): LocalParts {
    const values = new Map<string, number>();
    for (const part of format.formatToParts(ms)) {
      if (part.type !== "literal") values.set(part.type, Number(part.value));
    }
    const date = {
      year: values.get("year") ?? 1970,
      month: values.get("month") ?? 1,
      day: values.get("day") ?? 1,
    };
    return {
      ...date,
      hour: (values.get("hour") ?? 0) % 24,
      minute: values.get("minute") ?? 0,
      weekday: weekdayOf(date),
    };
  }

  function offsetMs(ms: number): number {
    const local = parts(ms);
    const wall = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    return wall - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  }

  function dayStart(date: LocalDate): number {
    const wall = calendarMs(date);
    const first = wall - offsetMs(wall);
    const second = wall - offsetMs(first);
    const onDate = [first, second].filter((candidate) =>
      sameDate(parts(candidate), date),
    );
    return onDate.length === 0 ? second : Math.min(...onDate);
  }

  return { timeZone: format.resolvedOptions().timeZone, parts, dayStart };
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function rangeStartMs(args: {
  range: RangePreset;
  now: number;
  clock: ZonedClock;
}): number | null {
  if (args.range === "all") return null;
  const today = args.clock.parts(args.now);
  return args.clock.dayStart(addDays(today, 1 - RANGE_DAYS[args.range]));
}

export function formatLocalDateTime(clock: ZonedClock, ms: number): string {
  const local = clock.parts(ms);
  return `${dateKey(local)} ${pad(local.hour, 2)}:${pad(local.minute, 2)}`;
}
