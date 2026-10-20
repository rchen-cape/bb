import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  ThreadTitleMentionResourcesProvider,
  useSidebarThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { CommandPalette } from "@/components/commands/CommandPalette";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { PluginAppOverlays } from "@/components/plugin/PluginAppOverlays";
import { PluginPagePanelHost } from "@/components/plugin/PluginPagePanelHost";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useDataDirectoryCommand } from "@/hooks/useDataDirectoryCommand";
import { usePluginCachePruneCommand } from "@/hooks/usePluginCachePruneCommand";
import { usePluginSafeModeCommands } from "@/hooks/usePluginSafeModeCommands";
import { useServerDaemonLogsCommand } from "@/hooks/useServerDaemonLogsCommand";
import { useWindowReloadCommand } from "@/hooks/useWindowReloadCommand";
import { PluginPanelView } from "@/views/PluginPanelView";
import { ThreadDetailWorkerPoolProvider } from "@/views/thread-detail/ThreadDetailWorkerPoolProvider";
import { HistoryCommandHandlers } from "./HistoryCommandHandlers";
import {
  POPOUT_CONTENT_SHELL_CLASS,
  POPOUT_PLUGIN_PANEL_PANE_ID,
  PopoutPluginPanelHeader,
  type PopoutPluginPanelRoute,
} from "./PopoutPluginPanelChrome";

export function PopoutPluginPanelLayout({
  panelPath,
  pluginId,
  subPath,
}: PopoutPluginPanelRoute) {
  useServerDaemonLogsCommand();
  useDataDirectoryCommand();
  useWindowReloadCommand();
  usePluginSafeModeCommands();
  usePluginCachePruneCommand();
  const sidebarNavigationQuery = useSidebarNavigation();
  const titleMentionResources = useSidebarThreadTitleMentionResources(
    sidebarNavigationQuery.data,
  );
  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <ProjectActionsProvider>
        <ThreadTitleMentionResourcesProvider {...titleMentionResources}>
          <ThreadActionsProvider>
            <SidebarProvider
              defaultOpen={false}
              data-testid="popout-plugin-panel-layout"
            >
              <HistoryCommandHandlers />
              <div
                data-app-content-shell=""
                className={POPOUT_CONTENT_SHELL_CLASS}
              >
                <main className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
                  <ThreadDetailWorkerPoolProvider>
                    <PluginPagePanelHost
                      flushPageInsets
                      pluginId={pluginId}
                      panelPath={panelPath}
                      paneId={POPOUT_PLUGIN_PANEL_PANE_ID}
                      subPath={subPath}
                    >
                      <div className="flex h-full min-h-0 flex-col">
                        <PopoutPluginPanelHeader
                          pluginId={pluginId}
                          panelPath={panelPath}
                          subPath={subPath}
                          rendersPluginHeaderContent
                        />
                        <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
                          <PluginPanelView
                            pluginId={pluginId}
                            panelPath={panelPath}
                            subPath={subPath}
                          />
                        </div>
                      </div>
                    </PluginPagePanelHost>
                  </ThreadDetailWorkerPoolProvider>
                </main>
              </div>
            </SidebarProvider>
            <PluginAppOverlays />
            <CommandPalette threadId={null} projectId={null} />
            <NotificationCenter />
          </ThreadActionsProvider>
        </ThreadTitleMentionResourcesProvider>
      </ProjectActionsProvider>
    </TooltipProvider>
  );
}
