import { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  listPanes,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  paneContentForPathname,
  reconcileLayoutForContent,
} from "@/views/thread-detail/splitThreadNavigation";

export function isSidebarRailOnlyLayout(
  storedLayout: SplitLayout | null,
  routeContent: PaneContent | null,
): boolean {
  if (routeContent?.kind !== "plugin-panel") return false;
  const layout = reconcileLayoutForContent(storedLayout, routeContent);
  return listPanes(layout.root).every(
    (pane) =>
      pane.content.kind !== "thread" && pane.content.kind !== "new-thread",
  );
}

export function useIsSidebarRailOnly(
  pathname: string,
  isPluginPanelAvailable: boolean,
): boolean {
  const isCompactViewport = useIsCompactViewport();
  const railOnlyAtom = useMemo(() => {
    const routeContent = paneContentForPathname(pathname);
    return atom((get) =>
      isSidebarRailOnlyLayout(get(splitLayoutAtom), routeContent),
    );
  }, [pathname]);
  const isRailOnly = useAtomValue(railOnlyAtom);
  return !isCompactViewport && isPluginPanelAvailable && isRailOnly;
}
