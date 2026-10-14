import type { Coverage, RangePreset, TokenTotals } from "../src/contract.js";

const LOCALE = "en-US";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const COMPACT = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const INTEGER = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

export const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const RANGE_LABELS: Record<RangePreset, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  all: "All",
};

const RANGE_PERIODS: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "all time",
};

export function rangeDescription(range: RangePreset): string {
  return range === "all" ? "All time" : `Last ${RANGE_PERIODS[range]}`;
}

export function previousPeriodDescription(range: RangePreset): string | null {
  return range === "all" ? null : `previous ${RANGE_PERIODS[range]}`;
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return COMPACT.format(Math.round(value));
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return INTEGER.format(Math.round(value));
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  if (ratio > 0 && ratio < 0.01) return "<1%";
  if (ratio > 0.99 && ratio < 1) return ">99%";
  return `${Math.round(ratio * 100)}%`;
}

export function shareOf(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return part / whole;
}

export function cacheHitRate(
  totals: Pick<
    TokenTotals,
    "inputTokens" | "cacheReadTokens" | "cacheWriteTokens"
  >,
): number | null {
  return shareOf(
    totals.cacheReadTokens,
    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
  );
}

export type DeltaDirection = "up" | "down" | "flat";

export interface Delta {
  direction: DeltaDirection;
  text: string;
}

export function describeDelta(current: number, previous: number): Delta | null {
  if (!(previous > 0)) return null;
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < 0.005) return { direction: "flat", text: "No change" };
  return {
    direction: ratio > 0 ? "up" : "down",
    text: formatPercent(Math.abs(ratio)),
  };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone });
  dateFormatters.set(key, formatter);
  return formatter;
}

function yearIn(ms: number, timeZone: string): string {
  return dateFormatter(timeZone, { year: "numeric" }).format(ms);
}

export function formatDay(ms: number, timeZone: string): string {
  return dateFormatter(timeZone, { month: "short", day: "numeric" }).format(ms);
}

export function formatCalendarDay(
  ms: number,
  timeZone: string,
  nowMs: number,
): string {
  if (yearIn(ms, timeZone) === yearIn(nowMs, timeZone)) {
    return formatDay(ms, timeZone);
  }
  return dateFormatter(timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(ms);
}

export function formatWeekdayDay(ms: number, timeZone: string): string {
  return dateFormatter(timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(ms);
}

export function formatTime(ms: number, timeZone: string): string {
  return dateFormatter(timeZone, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export function formatDateTime(ms: number, timeZone: string): string {
  return dateFormatter(timeZone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export function formatBucket(
  startMs: number,
  bucket: "day" | "week",
  timeZone: string,
): string {
  return bucket === "week"
    ? `Week of ${formatDay(startMs, timeZone)}`
    : formatWeekdayDay(startMs, timeZone);
}

export function formatRelativeTime(args: {
  timestamp: number;
  now: number;
  timeZone: string;
}): string {
  const diffMs = args.now - args.timestamp;
  if (diffMs < MINUTE_MS) return "just now";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) return "yesterday";
  if (diffMs < WEEK_MS) return `${days}d ago`;
  if (diffMs < 5 * WEEK_MS) return `${Math.floor(diffMs / WEEK_MS)}w ago`;
  return formatCalendarDay(args.timestamp, args.timeZone, args.now);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

export function formatHourRange(startHour: number, hours: number): string {
  const end = (startHour + hours) % 24;
  return `${String(startHour).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`;
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${formatInteger(count)} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function coverageSummary(args: {
  coverage: Coverage;
  totalTokens: number;
  timeZone: string;
  nowMs: number;
}): string {
  const { coverage } = args;
  const tracking =
    coverage.trackingSinceMs === null
      ? "Not tracking yet"
      : `Tracking since ${formatCalendarDay(coverage.trackingSinceMs, args.timeZone, args.nowMs)}`;
  const estimated = shareOf(coverage.backfilledTokens, args.totalTokens);
  if (estimated === null || coverage.backfilledTokens === 0) return tracking;
  return `${tracking} · ${formatPercent(estimated)} estimated`;
}

export function indexingProgress(coverage: Coverage): string | null {
  if (!coverage.scanning && coverage.pendingThreads === 0) return null;
  if (coverage.pendingThreads === 0) return "Syncing threads…";
  return `Syncing ${pluralize(coverage.pendingThreads, "thread")}…`;
}

export function shortId(id: string): string {
  return id.length <= 10 ? id : `…${id.slice(-8)}`;
}

export function resolveTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === "string" && zone.length > 0 && zone.length <= 64
    ? zone
    : "UTC";
}
