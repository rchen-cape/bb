import type { ActivityCell } from "../../src/contract.js";
import { ActivityHeatmap } from "../charts/activity-heatmap.js";
import {
  ChartCard,
  DataTable,
  useChartView,
  type TableColumn,
} from "../charts/chart-card.js";
import { WEEKDAY_ORDER, buildActivityMatrix } from "../charts/heatmap.js";
import type { ChartPalette } from "../charts/palette.js";
import { WEEKDAY_SHORT, formatCompact, formatHourRange } from "../format.js";

interface HourRow {
  hour: number;
  tokens: readonly number[];
}

export function ActivityCard({
  cells,
  palette,
  timeZone,
}: {
  cells: readonly ActivityCell[];
  palette: ChartPalette;
  timeZone: string;
}) {
  const [view, setView] = useChartView();
  const matrix = buildActivityMatrix(cells, 1);
  const rows: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tokens: WEEKDAY_ORDER.map((weekday) => matrix.tokens[weekday]?.[hour] ?? 0),
  }));
  const columns: TableColumn<HourRow>[] = [
    {
      id: "hour",
      header: "Hour",
      cell: (row) => formatHourRange(row.hour, 1),
    },
    ...WEEKDAY_ORDER.map((weekday, index): TableColumn<HourRow> => ({
      id: String(weekday),
      header: WEEKDAY_SHORT[weekday],
      align: "right",
      cell: (row) => {
        const value = row.tokens[index] ?? 0;
        return value === 0 ? "—" : formatCompact(value);
      },
    })),
  ];

  return (
    <ChartCard
      title="Activity"
      description={`Tokens by weekday and hour, in ${timeZone}`}
      view={view}
      onViewChange={setView}
    >
      {view === "chart" ? (
        <ActivityHeatmap cells={cells} palette={palette} />
      ) : (
        <DataTable
          caption="Activity by weekday and hour"
          columns={columns}
          rows={rows}
          rowKey={(row) => String(row.hour)}
        />
      )}
    </ChartCard>
  );
}
