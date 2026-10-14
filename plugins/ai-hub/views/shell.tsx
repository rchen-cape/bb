import { useCallback, useEffect, useMemo, type ComponentType } from "react";
import {
  useBbNavigate,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { AI_HUB_PANEL_PATH } from "../src/contract.js";
import { USAGE_SECTION_ID, subPathSegments } from "./route.js";
import { NotFound } from "./states.js";
import { UsageSection } from "./usage/section.js";

export interface HubSectionProps {
  rest: readonly string[];
  navigate: (subPath: string, options?: { replace?: boolean }) => void;
}

export interface HubSection {
  id: string;
  title: string;
  icon: string;
  component: ComponentType<HubSectionProps>;
}

export const HUB_SECTIONS: readonly HubSection[] = [
  {
    id: USAGE_SECTION_ID,
    title: "Usage",
    icon: "ChartColumn",
    component: UsageSection,
  },
];

export function AiHubPanel({ subPath }: PluginNavPanelProps) {
  const bbNavigate = useBbNavigate();
  const segments = useMemo(() => subPathSegments(subPath), [subPath]);
  const navigate = useCallback(
    (next: string, options?: { replace?: boolean }) => {
      bbNavigate.toPluginPanel(AI_HUB_PANEL_PATH, {
        subPath: next,
        ...options,
      });
    },
    [bbNavigate],
  );
  const first = segments[0];
  const fallback = HUB_SECTIONS[0];
  const section = HUB_SECTIONS.find((entry) => entry.id === first);

  useEffect(() => {
    if (first === undefined && fallback !== undefined) {
      navigate(fallback.id, { replace: true });
    }
  }, [first, fallback, navigate]);

  return (
    <TooltipProvider delayDuration={250}>
      <Tabs
        value={section?.id ?? ""}
        onValueChange={(id) => navigate(id)}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-surface-raised px-2">
          <TabsList
            aria-label="AI Hub sections"
            className="h-7 justify-start gap-1 bg-transparent p-0"
          >
            {HUB_SECTIONS.map((entry) => (
              <TabsTrigger
                key={entry.id}
                value={entry.id}
                className="h-7 gap-1.5 rounded-sm px-2 text-xs text-subtle-foreground hover:bg-state-hover hover:text-foreground data-[state=active]:bg-state-active data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Icon name={entry.icon} className="size-3.5" aria-hidden />
                {entry.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {section !== undefined ? (
          <TabsContent
            value={section.id}
            className="mt-0 min-h-0 flex-1 overflow-y-auto focus-visible:ring-0 focus-visible:ring-offset-0"
          >
            <section.component rest={segments.slice(1)} navigate={navigate} />
          </TabsContent>
        ) : first !== undefined && fallback !== undefined ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NotFound
              title="Page not found"
              message="AI Hub has no page at this address."
              backLabel={`Back to ${fallback.title}`}
              onBack={() => navigate(fallback.id)}
            />
          </div>
        ) : null}
      </Tabs>
    </TooltipProvider>
  );
}
