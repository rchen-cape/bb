import type { UsageReport } from "../../src/contract.js";
import { DeltaText, Meter, Sparkline, StatTile } from "../charts/figures.js";
import {
  TOKEN_TYPES,
  type ChartPalette,
  type TokenType,
} from "../charts/palette.js";
import { chunkFromEnd, sum } from "../charts/scale.js";
import {
  cacheHitRate,
  describeDelta,
  formatCompact,
  formatInteger,
  formatPercent,
  pluralize,
  previousPeriodDescription,
  rangeDescription,
  shareOf,
} from "../format.js";

const SPARK_POINTS = 12;

const TILE_LABELS: Record<TokenType, string> = {
  inputTokens: "Input (uncached)",
  cacheReadTokens: "Cache read",
  cacheWriteTokens: "Cache write",
  outputTokens: "Output",
};

export function UsageHero({ report }: { report: UsageReport }) {
  const range = report.filters.range;
  const total = report.totals.totalTokens;
  const previous = range === "all" ? null : report.previousTotals;
  const period = previousPeriodDescription(range);
  const delta =
    previous === null ? null : describeDelta(total, previous.totalTokens);
  return (
    <section aria-label="Total tokens" className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {rangeDescription(range)} · total tokens
      </p>
      <p className="text-5xl font-semibold tracking-tight text-foreground">
        {formatCompact(total)}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>
          {formatInteger(total)} tokens across{" "}
          {pluralize(report.totals.threads, "thread")}
        </span>
        {delta !== null && period !== null ? (
          <DeltaText delta={delta} period={period} />
        ) : previous !== null && period !== null ? (
          <span>Nothing recorded in the {period}</span>
        ) : null}
      </p>
    </section>
  );
}

export function KpiTiles({
  report,
  palette,
}: {
  report: UsageReport;
  palette: ChartPalette;
}) {
  const { totals, timeline, subagents } = report;
  const range = report.filters.range;
  const previous = range === "all" ? null : report.previousTotals;
  const period = previousPeriodDescription(range);
  const chunks = chunkFromEnd(timeline, SPARK_POINTS);
  const spark = (field: TokenType | "turns") =>
    chunks.map((chunk) => sum(chunk.map((point) => point[field])));
  const delta = (field: TokenType | "turns") =>
    previous === null ? null : describeDelta(totals[field], previous[field]);
  const hitRate = cacheHitRate(totals);

  return (
    <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
      {TOKEN_TYPES.map((type) => {
        const share = `${formatPercent(shareOf(totals[type], totals.totalTokens))} of total`;
        return (
          <StatTile
            key={type}
            label={TILE_LABELS[type]}
            value={formatCompact(totals[type])}
            delta={delta(type)}
            period={period}
            detail={
              type === "outputTokens" && totals.reasoningTokens > 0
                ? `${share} · ${formatCompact(totals.reasoningTokens)} reasoning`
                : share
            }
          >
            <Sparkline values={spark(type)} color={palette.tokens[type]} />
          </StatTile>
        );
      })}
      <StatTile
        label="Cache hit rate"
        value={formatPercent(hitRate)}
        detail="Cache reads out of all input"
      >
        <Meter
          label="Cache hit rate"
          ratio={hitRate}
          fill={palette.accent}
          track={palette.meterTrack}
        />
      </StatTile>
      <StatTile
        label="Turns"
        value={formatCompact(totals.turns)}
        delta={delta("turns")}
        period={period}
      >
        <Sparkline values={spark("turns")} color={palette.accent} />
      </StatTile>
      <StatTile
        label="Threads"
        value={formatCompact(totals.threads)}
        detail="With usage in this range"
      />
      <StatTile
        label="Subagent tokens"
        value={formatCompact(subagents.totalTokens)}
        detail={`Reported by subagents; not split by type · ${pluralize(subagents.tasks, "task")}`}
      />
    </div>
  );
}
