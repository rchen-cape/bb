import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import type { Coverage } from "../../src/contract.js";
import { indexingProgress } from "../format.js";

export function EmptyUsage({ coverage }: { coverage: Coverage }) {
  const progress = indexingProgress(coverage);
  return (
    <EmptyStatePanel className="space-y-2 px-4 py-8">
      <Icon
        name="ChartColumn"
        className="mx-auto size-5 text-subtle-foreground"
        aria-hidden
      />
      <p className="font-medium text-foreground">
        No token usage recorded in this range
      </p>
      <p className="mx-auto max-w-md text-xs">
        Usage is recorded as agents finish turns. Threads from before tracking
        began contribute only their last recorded snapshot, so their older
        history shows up as one estimated entry.
      </p>
      {progress !== null ? (
        <p className="inline-flex items-center gap-1 text-xs">
          <Icon name="Loading" className="size-3.5 animate-spin" aria-hidden />
          {progress}
        </p>
      ) : null}
    </EmptyStatePanel>
  );
}
