import type { ComponentProps, ReactNode } from "react";
import { defineSplit } from "@/lib/define-split";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { PluginDetailOpenerBoundary } from "./plugin-detail-opener";

const LazyPluginPanelRightPanelHost = defineSplit<
  ComponentProps<
    typeof import("@/components/plugin/PluginPanelRightPanelHost").PluginPanelRightPanelHost
  >
>({
  id: "plugin-panel-right-panel-host",
  load: () =>
    import("@/components/plugin/PluginPanelRightPanelHost").then(
      (module) => module.PluginPanelRightPanelHost,
    ),
  loading: () => null,
  tier: "intent",
});

export const preloadPluginPagePanelHost = LazyPluginPanelRightPanelHost.preload;

export function PluginPagePanelHost({
  children,
  ...props
}: {
  children: ReactNode;
  flushPageInsets?: boolean;
  paneId?: string;
  panelPath: string;
  pluginId: string;
  subPath: string;
}) {
  const pane = useOptionalPaneContext();
  return (
    <PluginDetailOpenerBoundary
      key={`${props.pluginId}/${props.panelPath}`}
      isFocused={pane?.isFocused ?? true}
    >
      <LazyPluginPanelRightPanelHost {...props}>
        {children}
      </LazyPluginPanelRightPanelHost>
    </PluginDetailOpenerBoundary>
  );
}
