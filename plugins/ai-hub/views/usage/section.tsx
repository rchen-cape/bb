import { useState } from "react";
import { resolveTimeZone } from "../format.js";
import {
  USAGE_SECTION_ID,
  parseUsageRoute,
  usageThreadSubPath,
} from "../route.js";
import type { HubSectionProps } from "../shell.js";
import { NotFound } from "../states.js";
import { UsageDashboard } from "./dashboard.js";
import { DEFAULT_USAGE_FILTERS, type UsageFilterState } from "./filters.js";
import { ThreadUsageView } from "./thread-detail.js";

export function UsageSection({ rest, navigate }: HubSectionProps) {
  const route = parseUsageRoute(rest);
  const [filters, setFilters] = useState<UsageFilterState>(
    DEFAULT_USAGE_FILTERS,
  );
  const [timeZone] = useState(resolveTimeZone);
  const backToUsage = () => navigate(USAGE_SECTION_ID);

  if (route.view === "thread") {
    return (
      <ThreadUsageView
        key={route.threadId}
        threadId={route.threadId}
        timeZone={timeZone}
        onBack={backToUsage}
      />
    );
  }
  if (route.view === "unknown") {
    return (
      <NotFound
        title="Page not found"
        message="This part of Usage does not exist."
        backLabel="Back to Usage"
        onBack={backToUsage}
      />
    );
  }
  return (
    <UsageDashboard
      filters={filters}
      onFiltersChange={setFilters}
      timeZone={timeZone}
      onOpenThreadUsage={(threadId) => navigate(usageThreadSubPath(threadId))}
    />
  );
}
