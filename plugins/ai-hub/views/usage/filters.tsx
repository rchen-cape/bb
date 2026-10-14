import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { ToggleGroup, ToggleGroupItem } from "@bb/shared-ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  RANGE_PRESETS,
  rangePresetSchema,
  type Coverage,
  type FilterOption,
  type RangePreset,
} from "../../src/contract.js";
import {
  SEGMENT_GROUP_CLASS,
  SEGMENT_ITEM_CLASS,
} from "../charts/chart-card.js";
import {
  RANGE_LABELS,
  coverageSummary,
  indexingProgress,
  rangeDescription,
} from "../format.js";

export interface UsageFilterState {
  range: RangePreset;
  projectId: string | null;
  providerId: string | null;
}

export const DEFAULT_USAGE_FILTERS: UsageFilterState = {
  range: "30d",
  projectId: null,
  providerId: null,
};

export const COVERAGE_EXPLANATION =
  "bb keeps only the latest usage snapshot of each thread. Tokens used before tracking began, or while bb was not running, are estimated from that snapshot and dated to when it was taken, not to the turns that used them.";

const ALL_VALUE = "__all__";

export function FilterRow({
  filters,
  onChange,
  projects,
  providers,
  coverage,
  totalTokens,
  timeZone,
  nowMs,
  rescanning,
  onRescan,
}: {
  filters: UsageFilterState;
  onChange: (next: UsageFilterState) => void;
  projects: readonly FilterOption[] | null;
  providers: readonly FilterOption[] | null;
  coverage: Coverage | null;
  totalTokens: number;
  timeZone: string;
  nowMs: number;
  rescanning: boolean;
  onRescan: () => void;
}) {
  const progress = coverage === null ? null : indexingProgress(coverage);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        value={filters.range}
        aria-label="Time range"
        className={SEGMENT_GROUP_CLASS}
        onValueChange={(next) => {
          const parsed = rangePresetSchema.safeParse(next);
          if (parsed.success) onChange({ ...filters, range: parsed.data });
        }}
      >
        {RANGE_PRESETS.map((preset) => (
          <ToggleGroupItem
            key={preset}
            value={preset}
            aria-label={rangeDescription(preset)}
            className={SEGMENT_ITEM_CLASS}
          >
            {RANGE_LABELS[preset]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <FilterSelect
        label="Project"
        allLabel="All projects"
        value={filters.projectId}
        options={projects}
        onChange={(projectId) => onChange({ ...filters, projectId })}
      />
      <FilterSelect
        label="Provider"
        allLabel="All providers"
        value={filters.providerId}
        options={providers}
        onChange={(providerId) => onChange({ ...filters, providerId })}
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {progress !== null ? (
          <span
            role="status"
            className="inline-flex items-center gap-1 text-xs text-subtle-foreground"
          >
            <Icon
              name="Loading"
              className="size-3.5 animate-spin"
              aria-hidden
            />
            {progress}
          </span>
        ) : null}
        {coverage !== null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-sm text-xs text-subtle-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Icon name="Info" className="size-3.5" aria-hidden />
                {coverageSummary({ coverage, totalTokens, timeZone, nowMs })}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {COVERAGE_EXPLANATION}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={rescanning}
          onClick={onRescan}
        >
          <Icon
            name="ArrowReloadHorizontal"
            className={cn(rescanning && "animate-spin")}
            aria-hidden
          />
          Rescan
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: readonly FilterOption[] | null;
  onChange: (next: string | null) => void;
}) {
  const known = options ?? [];
  const items =
    value !== null && !known.some((option) => option.id === value)
      ? [...known, { id: value, label: value }]
      : known;
  return (
    <Select
      value={value ?? ALL_VALUE}
      disabled={options === null}
      onValueChange={(next) => onChange(next === ALL_VALUE ? null : next)}
    >
      <SelectTrigger
        aria-label={label}
        className="h-7 w-auto max-w-56 min-w-32 gap-1.5 px-2 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE} className="text-xs">
          {allLabel}
        </SelectItem>
        {items.map((option) => (
          <SelectItem key={option.id} value={option.id} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
