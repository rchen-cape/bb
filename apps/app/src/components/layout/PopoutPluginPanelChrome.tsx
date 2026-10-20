import { useEffect, useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import {
  getBbDesktopInfo,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  shouldReserveMacosTrafficLights,
} from "@/lib/bb-desktop";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { AppPageHeader } from "./AppPageHeader";

export const POPOUT_PLUGIN_PANEL_PANE_ID = "popout";

export const POPOUT_CONTENT_SHELL_CLASS =
  "relative flex h-full min-h-0 min-w-0 w-full flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]";

export interface PopoutPluginPanelRoute {
  panelPath: string;
  pluginId: string;
  subPath: string;
}

interface PopoutPluginPanelHeaderProps extends PopoutPluginPanelRoute {
  rendersPluginHeaderContent: boolean;
}

export function PopoutPluginPanelHeader({
  panelPath,
  pluginId,
  rendersPluginHeaderContent,
  subPath,
}: PopoutPluginPanelHeaderProps) {
  const navPanelChrome = usePluginNavPanelChrome();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });
  const panelEntry = navPanelChrome.find(
    (candidate) =>
      candidate.chrome.pluginId === pluginId &&
      candidate.chrome.path === panelPath,
  );
  const livePanel = panelEntry?.panel ?? null;
  const panel = rendersPluginHeaderContent ? livePanel : null;
  const panelChrome = panelEntry?.chrome;
  const documentTitle = livePanel?.title ?? panelChrome?.title ?? "bb";
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);
  return (
    <AppPageHeader
      ownsWindowTopLeft={false}
      className={
        reserveMacosTrafficLights
          ? MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS
          : undefined
      }
      center={
        panelChrome ? (
          <PluginPanelHeaderCenter
            chrome={panelChrome}
            panel={panel}
            subPath={subPath}
          />
        ) : null
      }
      actions={
        panel ? (
          <PluginPanelHeaderActions
            panel={panel}
            paneId={POPOUT_PLUGIN_PANEL_PANE_ID}
            subPath={subPath}
          />
        ) : null
      }
    />
  );
}

export function PopoutPluginPanelFallback(route: PopoutPluginPanelRoute) {
  return (
    <SidebarProvider defaultOpen={false}>
      <div className={POPOUT_CONTENT_SHELL_CLASS}>
        <PopoutPluginPanelHeader
          {...route}
          rendersPluginHeaderContent={false}
        />
      </div>
    </SidebarProvider>
  );
}
