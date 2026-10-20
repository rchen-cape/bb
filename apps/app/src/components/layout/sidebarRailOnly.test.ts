import { describe, expect, it } from "vitest";
import {
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";
import {
  createSinglePaneLayout,
  reconcileLayoutForContent,
} from "@/views/thread-detail/splitThreadNavigation";
import { isSidebarRailOnlyLayout } from "./sidebarRailOnly";

const THREAD = { projectId: "proj_one", threadId: "thr_one" };
const NOTES: PaneContent = {
  kind: "plugin-panel",
  pluginId: "notes",
  panelPath: "notes",
  subPath: "",
};
const PLUGIN_DETAIL: PaneContent = { kind: "plugin-detail", pluginId: "notes" };

const singleThread = createSinglePaneLayout(THREAD);
const singleNewThread = reconcileLayoutForContent(null, { kind: "new-thread" });
const newThreadBesideNotes = splitPane(
  singleNewThread,
  singleNewThread.focusedPaneId,
  "right",
  NOTES,
);
const threadBesideNotes = splitPane(
  singleThread,
  singleThread.focusedPaneId,
  "right",
  NOTES,
);
const threadFocusedBesidePluginDetail: SplitLayout = {
  ...splitPane(
    singleThread,
    singleThread.focusedPaneId,
    "right",
    PLUGIN_DETAIL,
  ),
  focusedPaneId: singleThread.focusedPaneId,
};

describe("isSidebarRailOnlyLayout", () => {
  it.each<{
    label: string;
    layout: SplitLayout | null;
    routeContent: PaneContent | null;
    railOnly: boolean;
  }>([
    {
      label: "shows only the rail on a plugin page with no saved layout",
      layout: null,
      routeContent: NOTES,
      railOnly: true,
    },
    {
      label: "shows only the rail when a plugin page replaces the only thread",
      layout: singleThread,
      routeContent: NOTES,
      railOnly: true,
    },
    {
      label:
        "shows only the rail when a plugin page replaces the thread beside a plugin detail",
      layout: threadFocusedBesidePluginDetail,
      routeContent: NOTES,
      railOnly: true,
    },
    {
      label: "keeps the sidebar for a plugin page split beside a thread",
      layout: threadBesideNotes,
      routeContent: NOTES,
      railOnly: false,
    },
    {
      label: "keeps the sidebar for a plugin page split beside new thread",
      layout: newThreadBesideNotes,
      routeContent: NOTES,
      railOnly: false,
    },
    {
      label: "keeps the sidebar on a plugin detail page",
      layout: null,
      routeContent: PLUGIN_DETAIL,
      railOnly: false,
    },
    {
      label: "keeps the sidebar on a thread",
      layout: threadBesideNotes,
      routeContent: { kind: "thread", ...THREAD },
      railOnly: false,
    },
    {
      label: "keeps the sidebar on new thread",
      layout: null,
      routeContent: { kind: "new-thread" },
      railOnly: false,
    },
    {
      label: "keeps the sidebar on routes without pane content",
      layout: threadBesideNotes,
      routeContent: null,
      railOnly: false,
    },
  ])("$label", ({ layout, routeContent, railOnly }) => {
    expect(isSidebarRailOnlyLayout(layout, routeContent)).toBe(railOnly);
  });
});
