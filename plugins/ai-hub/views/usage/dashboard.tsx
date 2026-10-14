import { useEffect, useMemo, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  AiHubRpcContract,
  Coverage,
  UsageFilters,
  UsageReport,
} from "../../src/contract.js";
import { useChartPalette } from "../charts/palette.js";
import { pluralize } from "../format.js";
import { ErrorRow, LoadingLine } from "../states.js";
import { errorMessage, useAiHubQuery } from "../use-ai-hub-query.js";
import { ActivityCard } from "./activity-card.js";
import { Breakdowns } from "./breakdowns.js";
import { ContextCard } from "./context-card.js";
import { EmptyUsage } from "./empty-usage.js";
import { FilterRow, type UsageFilterState } from "./filters.js";
import { KpiTiles, UsageHero } from "./overview.js";
import { TimelineCard } from "./timeline-card.js";
import { TopThreads } from "./top-threads.js";

export const STATUS_POLL_MS = 4000;

function isIndexing(coverage: Coverage): boolean {
  return coverage.scanning || coverage.pendingThreads > 0;
}

export function UsageDashboard({
  filters,
  onFiltersChange,
  timeZone,
  onOpenThreadUsage,
}: {
  filters: UsageFilterState;
  onFiltersChange: (next: UsageFilterState) => void;
  timeZone: string;
  onOpenThreadUsage: (threadId: string) => void;
}) {
  const rpc = useRpc<AiHubRpcContract>();
  const navigate = useBbNavigate();
  const palette = useChartPalette();
  const request = useMemo<UsageFilters>(
    () => ({ ...filters, timeZone }),
    [filters, timeZone],
  );
  const query = useAiHubQuery(JSON.stringify(request), (client) =>
    client.call("report", request),
  );
  const report = query.data;
  const refresh = query.refresh;
  const busy = query.loading || query.stale;
  const [rescanning, setRescanning] = useState(false);
  const [live, setLive] = useState<{
    report: UsageReport;
    coverage: Coverage;
  } | null>(null);
  const coverage =
    report === null
      ? null
      : live !== null && live.report === report
        ? {
            ...report.coverage,
            pendingThreads: live.coverage.pendingThreads,
            scanning: live.coverage.scanning,
            indexedThreads: live.coverage.indexedThreads,
            lastIndexedAtMs: live.coverage.lastIndexedAtMs,
          }
        : report.coverage;
  const polling = report !== null && isIndexing(report.coverage);

  useEffect(() => {
    if (!polling || report === null) return;
    let cancelled = false;
    const timer = setInterval(() => {
      rpc.call("status", null).then(
        (next) => {
          if (cancelled) return;
          setLive({ report, coverage: next });
          if (!isIndexing(next)) refresh();
        },
        () => {},
      );
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling, report, rpc, refresh]);

  const rescan = () => {
    setRescanning(true);
    rpc
      .call("rescan", null)
      .then(
        ({ queuedThreads }) => {
          toast.success(
            queuedThreads === 0
              ? "Every thread is already indexed."
              : `Queued ${pluralize(queuedThreads, "thread")} for a rescan.`,
          );
          refresh();
        },
        (cause: unknown) => {
          toast.error(`Couldn't start a rescan: ${errorMessage(cause)}`);
        },
      )
      .finally(() => setRescanning(false));
  };

  return (
    <div className="@container mx-auto w-full max-w-6xl space-y-4 p-4 md:p-5">
      <FilterRow
        filters={filters}
        onChange={onFiltersChange}
        projects={report?.options.projects ?? null}
        providers={report?.options.providers ?? null}
        coverage={coverage}
        totalTokens={report?.totals.totalTokens ?? 0}
        timeZone={timeZone}
        nowMs={report?.generatedAtMs ?? 0}
        rescanning={rescanning}
        onRescan={rescan}
      />
      {query.error !== null ? (
        <ErrorRow
          message={`Couldn't load usage: ${query.error}`}
          onRetry={refresh}
        />
      ) : null}
      {report === null ? (
        query.error === null ? (
          <LoadingLine>Loading usage…</LoadingLine>
        ) : null
      ) : (
        <div
          aria-busy={busy}
          className={cn(
            "space-y-4 transition-opacity duration-200",
            busy && "opacity-60",
          )}
        >
          {report.totals.totalTokens === 0 ? (
            <EmptyUsage coverage={coverage ?? report.coverage} />
          ) : (
            <>
              <UsageHero report={report} />
              <KpiTiles report={report} palette={palette} />
              <TimelineCard
                report={report}
                palette={palette}
                timeZone={timeZone}
              />
              <Breakdowns report={report} palette={palette} />
              <TopThreads
                rows={report.topThreads}
                timeZone={timeZone}
                nowMs={report.generatedAtMs}
                onOpenUsage={onOpenThreadUsage}
                onOpenThread={(threadId) => navigate.toThread(threadId)}
              />
              <ActivityCard
                cells={report.activity}
                palette={palette}
                timeZone={timeZone}
              />
              {report.context !== null ? (
                <ContextCard context={report.context} palette={palette} />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
