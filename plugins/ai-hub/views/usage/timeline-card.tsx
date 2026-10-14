import type { TimelinePoint, UsageReport } from "../../src/contract.js";
import {
  ChartCard,
  DataTable,
  Legend,
  useChartView,
  type TableColumn,
} from "../charts/chart-card.js";
import {
  TOKEN_TYPES,
  TOKEN_TYPE_LABELS,
  type ChartPalette,
} from "../charts/palette.js";
import { StackedColumnChart } from "../charts/stacked-columns.js";
import { formatBucket, formatDay, formatInteger } from "../format.js";

export function TimelineCard({
  report,
  palette,
  timeZone,
}: {
  report: UsageReport;
  palette: ChartPalette;
  timeZone: string;
}) {
  const [view, setView] = useChartView();
  const bucket = report.range.bucket;
  const series = TOKEN_TYPES.map((type) => ({
    id: type,
    label: TOKEN_TYPE_LABELS[type],
    color: palette.tokens[type],
  }));
  const columns: TableColumn<TimelinePoint>[] = [
    {
      id: "date",
      header: bucket === "week" ? "Week" : "Day",
      cell: (point) => formatBucket(point.startMs, bucket, timeZone),
    },
    ...TOKEN_TYPES.map((type): TableColumn<TimelinePoint> => ({
      id: type,
      header: TOKEN_TYPE_LABELS[type],
      align: "right",
      cell: (point) => formatInteger(point[type]),
    })),
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (point) => formatInteger(point.totalTokens),
    },
    {
      id: "turns",
      header: "Turns",
      align: "right",
      cell: (point) => formatInteger(point.turns),
    },
  ];

  return (
    <ChartCard
      title="Usage over time"
      description={
        bucket === "week"
          ? "Tokens per week, by type"
          : "Tokens per day, by type"
      }
      view={view}
      onViewChange={setView}
      legend={view === "chart" ? <Legend items={series} /> : undefined}
    >
      {view === "chart" ? (
        <StackedColumnChart
          label="Usage over time"
          series={series}
          points={report.timeline.map((point) => ({
            id: String(point.startMs),
            title: formatBucket(point.startMs, bucket, timeZone),
            tick: formatDay(point.startMs, timeZone),
            values: TOKEN_TYPES.map((type) => point[type]),
            total: point.totalTokens,
            estimated: false,
          }))}
        />
      ) : (
        <DataTable
          caption="Usage over time"
          columns={columns}
          rows={report.timeline}
          rowKey={(point) => String(point.startMs)}
        />
      )}
    </ChartCard>
  );
}
