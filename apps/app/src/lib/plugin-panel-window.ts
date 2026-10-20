import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { isInsideNativeShell } from "@/lib/native-shell";
import { getPluginSlotSnapshot } from "@/lib/plugin-slots";
import { withPopoutWindowQueryParam } from "@/lib/popout-window";
import { getPluginPanelRoutePath } from "@/lib/route-paths";

export const PLUGIN_PANEL_WINDOW_WIDTH = 960;
export const PLUGIN_PANEL_WINDOW_HEIGHT = 800;

interface OpenPluginPanelInWindowArgs {
  pluginId: string;
  path: string;
  subPath: string;
  isCompact: boolean;
}

export function canOpenPluginPanelWindow({
  isCompact,
}: {
  isCompact: boolean;
}): boolean {
  if (isCompact || isInsideNativeShell()) return false;
  const desktop = getBbDesktopInfo();
  return desktop === null || desktop.openPopoutWindow !== undefined;
}

export function getPluginPanelWindowPath({
  pluginId,
  path,
  subPath,
}: Omit<OpenPluginPanelInWindowArgs, "isCompact">): string {
  return withPopoutWindowQueryParam(
    getPluginPanelRoutePath({ pluginId, path, subPath }),
  );
}

export async function openPluginPanelInWindow({
  pluginId,
  path,
  subPath,
  isCompact,
}: OpenPluginPanelInWindowArgs): Promise<boolean> {
  if (!canOpenPluginPanelWindow({ isCompact })) return false;
  const isRegistered = getPluginSlotSnapshot().navPanels.some(
    (panel) => panel.pluginId === pluginId && panel.path === path,
  );
  if (!isRegistered) return false;
  const windowPath = getPluginPanelWindowPath({ pluginId, path, subPath });
  const panelRoot = getPluginPanelRoutePath({ pluginId, path });
  const { pathname } = new URL(windowPath, "http://bb.invalid");
  if (pathname !== panelRoot && !pathname.startsWith(`${panelRoot}/`)) {
    return false;
  }
  const desktop = getBbDesktopInfo();
  if (desktop !== null) {
    try {
      return (await desktop.openPopoutWindow?.({ path: windowPath })) ?? false;
    } catch {
      return false;
    }
  }
  let popup: Window | null;
  try {
    popup = window.open(
      windowPath,
      "_blank",
      `popup,width=${PLUGIN_PANEL_WINDOW_WIDTH},height=${PLUGIN_PANEL_WINDOW_HEIGHT}`,
    );
  } catch {
    return false;
  }
  if (popup === null) return false;
  popup.opener = null;
  return true;
}
