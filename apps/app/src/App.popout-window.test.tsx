// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { useContext, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { PierreWorkerPoolGateContext } from "@/lib/pierre-worker-pool-gate";
import { SPLIT_LAYOUT_STORAGE_KEY } from "@/lib/split-layout";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { AppRoutes } from "./App";

const popoutWindow = vi.hoisted(() => ({ isPopout: false }));

vi.mock("@/lib/popout-window", () => ({
  isPopoutWindow: () => popoutWindow.isPopout,
}));

vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-root">
      <nav data-testid="app-nav-rail" />
      {children}
    </div>
  ),
}));

vi.mock("./views/SplitWorkspaceRoute", async () => {
  const { useEffect } = await import("react");
  const { useSetAtom } = await import("jotai");
  const { splitLayoutAtom } = await import("@/lib/split-layout/atoms");
  const { createSinglePaneLayout } =
    await import("@/views/thread-detail/splitThreadNavigation");
  return {
    default: function SplitWorkspaceRoute() {
      const setLayout = useSetAtom(splitLayoutAtom);
      useEffect(() => {
        setLayout(
          createSinglePaneLayout({
            projectId: "proj_personal",
            threadId: "thr_1",
          }),
        );
      }, [setLayout]);
      return <div data-testid="split-workspace-route" />;
    },
  };
});

vi.mock("./views/thread-detail/LazyThreadDetailView", () => ({
  LazyThreadDetailView: { preload: () => Promise.resolve() },
}));

vi.mock("./views/LazyRootComposeView", () => ({
  LazyRootComposeView: { preload: () => Promise.resolve() },
}));

vi.mock("@/components/plugin/PluginPanelRightPanelHost", () => ({
  PluginPanelRightPanelHost: ({ children }: { children: ReactNode }) => (
    <div data-testid="plugin-panel-right-panel-host">{children}</div>
  ),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => undefined,
  useAppCommandShortcut: () => null,
}));

vi.mock("@/components/commands/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/notifications/NotificationCenter", () => ({
  NotificationCenter: () => null,
}));

vi.mock("@/components/plugin/PluginAppOverlays", () => ({
  PluginAppOverlays: () => null,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: undefined }),
}));

function registerNotesPanel(): void {
  setPluginSlotRegistrations(
    "notes",
    makePluginRegistrationSet({
      navPanels: [
        {
          id: "notes",
          title: "Notes",
          icon: "FileText",
          path: "notes",
          experimental_hideSidebarOnOpen: true,
          component: ({ subPath }: { subPath: string }) => (
            <div>Notes body {subPath}</div>
          ),
        },
      ],
    }),
  );
}

function renderRoutes(path: string): void {
  render(
    <JotaiProvider store={createStore()}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <RouteNavigationProvider>
            <AppRoutes />
          </RouteNavigationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

beforeEach(() => {
  popoutWindow.isPopout = false;
  registerNotesPanel();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.title = "";
});

describe("AppRoutes in a pop-out window", () => {
  it("renders only the plugin page on a plugin panel route", async () => {
    popoutWindow.isPopout = true;

    renderRoutes("/plugins/notes/notes/daily");

    expect(await screen.findByText("Notes body daily")).not.toBeNull();
    expect(
      screen.getByTestId("app-page-header-content-row").textContent,
    ).toContain("Notes");
    expect(screen.getByTestId("popout-plugin-panel-layout")).not.toBeNull();
    expect(document.querySelector("[data-app-content-shell]")).not.toBeNull();
    expect(screen.queryByTestId("app-layout-root")).toBeNull();
    expect(screen.queryByTestId("app-nav-rail")).toBeNull();
    expect(screen.queryByTestId("split-workspace-route")).toBeNull();
    await waitFor(() => expect(document.title).toBe("Notes"));
    expect(window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("bb.sidebar.open")).toBeNull();
  });

  it("gives the plugin page the code highlighting worker pool", async () => {
    popoutWindow.isPopout = true;
    setPluginSlotRegistrations(
      "diffs",
      makePluginRegistrationSet({
        navPanels: [
          {
            id: "review",
            title: "Review",
            icon: "FileText",
            path: "review",
            component: function ReviewPanel() {
              const gate = useContext(PierreWorkerPoolGateContext);
              return (
                <div>{gate === null ? "no worker pool" : "worker pool"}</div>
              );
            },
          },
        ],
      }),
    );

    renderRoutes("/plugins/diffs/review");

    expect(await screen.findByText("worker pool")).not.toBeNull();
    expect(screen.queryByText("no worker pool")).toBeNull();
  });

  it("falls back to the full layout off plugin routes without changing the shared split layout", async () => {
    popoutWindow.isPopout = true;

    renderRoutes("/threads/thr_1");

    expect(await screen.findByTestId("split-workspace-route")).not.toBeNull();
    expect(screen.getByTestId("app-layout-root")).not.toBeNull();
    expect(screen.queryByTestId("popout-plugin-panel-layout")).toBeNull();
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY),
      ).not.toBeNull(),
    );
    expect(window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it("keeps a normal window's plugin route in the split workspace", async () => {
    renderRoutes("/plugins/notes/notes");

    expect(await screen.findByTestId("split-workspace-route")).not.toBeNull();
    expect(screen.getByTestId("app-layout-root")).not.toBeNull();
    expect(screen.queryByTestId("popout-plugin-panel-layout")).toBeNull();
    await waitFor(() =>
      expect(
        window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY),
      ).not.toBeNull(),
    );
  });
});
