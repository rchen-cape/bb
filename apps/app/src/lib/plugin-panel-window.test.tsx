// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopPopoutWindowRequest } from "@bb/desktop-contract";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { AppNavRail } from "@/components/sidebar/AppNavRail";
import { SidebarNavigationModelProvider } from "@/components/sidebar/SidebarNavigationModel";
import { appToast } from "@/components/ui/app-toast";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { getThreadRoutePath } from "@/lib/route-paths";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";

const mocks = vi.hoisted(() => ({
  isInsideNativeShell: vi.fn(() => false),
}));

vi.mock("@/lib/native-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native-shell")>()),
  isInsideNativeShell: mocks.isInsideNativeShell,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: () => {},
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

type Outcome = "opened" | "refused" | "unavailable";

interface SurfaceCase {
  name: string;
  unavailableOutcome: Outcome;
  openDocs(options: { isCompactViewport: boolean }): Promise<Outcome>;
}

const THREAD_PATH = getThreadRoutePath({
  projectId: "proj_one",
  threadId: "thr_one",
});
const DOCS_WINDOW_PATH = "/plugins/garden/docs?bbWindow=popout";
const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function RouteProbe() {
  const location = useLocation();
  return (
    <output data-testid="route">{`${location.pathname}${location.search}`}</output>
  );
}

function renderInApp(children: ReactNode, isCompactViewport: boolean) {
  render(
    <Provider store={createStore()}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[THREAD_PATH]}>
          <CompactViewportOverrideProvider
            isCompactViewport={isCompactViewport}
          >
            <TooltipProvider>
              <SidebarProvider framed={false}>
                {children}
                <RouteProbe />
              </SidebarProvider>
            </TooltipProvider>
          </CompactViewportOverrideProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function SdkProbe({
  path,
  subPath,
  onResult,
}: {
  path: string;
  subPath?: string;
  onResult: (opened: boolean) => void;
}) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        void navigate
          .experimental_openPluginPanelInWindow(
            path,
            subPath === undefined ? undefined : { subPath },
          )
          .then(onResult);
      }}
    >
      Open from plugin
    </button>
  );
}

async function openFromSdk(
  path: string,
  options: { isCompactViewport?: boolean; subPath?: string } = {},
): Promise<boolean> {
  const results: boolean[] = [];
  renderInApp(
    <PluginSlotMount pluginId="garden" slotKind="test" slotId="probe">
      <SdkProbe
        path={path}
        {...(options.subPath === undefined ? {} : { subPath: options.subPath })}
        onResult={(opened) => results.push(opened)}
      />
    </PluginSlotMount>,
    options.isCompactViewport ?? false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open from plugin" }));
  await settle();
  expect(results).toHaveLength(1);
  return results[0] === true;
}

async function openFromRail(isCompactViewport: boolean): Promise<Outcome> {
  renderInApp(
    <SidebarNavigationModelProvider splitEnabled={false}>
      <AppNavRail
        isAppMode
        customize={{ isOpen: false, onOpenChange: () => {} }}
      />
    </SidebarNavigationModelProvider>,
    isCompactViewport,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
  const menu = await screen.findByRole("menu", { name: "Docs panel options" });
  const item = within(menu).queryByRole("menuitem", {
    name: "Open in window",
  });
  if (item === null) return "unavailable";
  fireEvent.click(item);
  await settle();
  return vi.mocked(appToast.error).mock.calls.length > 0 ? "refused" : "opened";
}

const SURFACES: readonly SurfaceCase[] = [
  {
    name: "nav rail item",
    unavailableOutcome: "unavailable",
    openDocs: ({ isCompactViewport }) => openFromRail(isCompactViewport),
  },
  {
    name: "plugin SDK",
    unavailableOutcome: "refused",
    openDocs: async ({ isCompactViewport }) =>
      (await openFromSdk("docs", { isCompactViewport })) ? "opened" : "refused",
  },
];

function installDesktop(
  openPopoutWindow?: (
    request: BbDesktopPopoutWindowRequest,
  ) => Promise<boolean>,
) {
  window.bbDesktop = {
    ...createBbDesktopApi(desktopInfo),
    ...(openPopoutWindow === undefined ? {} : { openPopoutWindow }),
  };
}

function popupWithOpener(): Window {
  return { opener: window } as unknown as Window;
}

function route(): string | null {
  return screen.getByTestId("route").textContent;
}

beforeEach(() => {
  mocks.isInsideNativeShell.mockReturnValue(false);
  vi.spyOn(appToast, "error").mockReturnValue("toast");
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  window.localStorage.clear();
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "BookOpen",
          path: "docs",
          component: () => null,
        },
      ],
    }),
  );
  setPluginSlotRegistrations(
    "orchard",
    registrationSet({
      navPanels: [
        {
          id: "board",
          title: "Board",
          icon: "columns",
          path: "board",
          component: () => null,
        },
      ],
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.bbDesktop;
  resetPluginFrontendBootStateForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe.each(SURFACES)("plugin page windows from the $name", (surface) => {
  it("asks the desktop shell for a pop-out window and stays on the current page", async () => {
    const openPopoutWindow = vi.fn(async () => true);
    installDesktop(openPopoutWindow);
    const open = vi.spyOn(window, "open");

    expect(await surface.openDocs({ isCompactViewport: false })).toBe("opened");

    expect(openPopoutWindow).toHaveBeenCalledTimes(1);
    expect(openPopoutWindow).toHaveBeenCalledWith({ path: DOCS_WINDOW_PATH });
    expect(open).not.toHaveBeenCalled();
    expect(route()).toBe(THREAD_PATH);
  });

  it("opens a browser popup without an opener on the web", async () => {
    const popup = popupWithOpener();
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    expect(await surface.openDocs({ isCompactViewport: false })).toBe("opened");

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      DOCS_WINDOW_PATH,
      "_blank",
      "popup,width=960,height=800",
    );
    expect(popup.opener).toBeNull();
    expect(route()).toBe(THREAD_PATH);
  });

  it("reports a blocked popup", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    expect(await surface.openDocs({ isCompactViewport: false })).toBe(
      "refused",
    );

    expect(open).toHaveBeenCalledTimes(1);
    expect(route()).toBe(THREAD_PATH);
  });

  it("reports a desktop shell that declines the window", async () => {
    installDesktop(vi.fn(async () => false));

    expect(await surface.openDocs({ isCompactViewport: false })).toBe(
      "refused",
    );
  });

  it("opens nothing on a compact viewport", async () => {
    const openPopoutWindow = vi.fn(async () => true);
    installDesktop(openPopoutWindow);
    const open = vi.spyOn(window, "open");

    expect(await surface.openDocs({ isCompactViewport: true })).toBe(
      surface.unavailableOutcome,
    );

    expect(openPopoutWindow).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens nothing inside the native mobile shell", async () => {
    mocks.isInsideNativeShell.mockReturnValue(true);
    const open = vi.spyOn(window, "open");

    expect(await surface.openDocs({ isCompactViewport: false })).toBe(
      surface.unavailableOutcome,
    );

    expect(open).not.toHaveBeenCalled();
  });

  it("never falls back to a browser popup in a desktop build without pop-out windows", async () => {
    installDesktop();
    const open = vi.spyOn(window, "open");

    expect(await surface.openDocs({ isCompactViewport: false })).toBe(
      surface.unavailableOutcome,
    );

    expect(open).not.toHaveBeenCalled();
    expect(route()).toBe(THREAD_PATH);
  });
});

describe("plugin page windows from the plugin SDK only", () => {
  it("refuses a path that is not one of the plugin's nav panels", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(popupWithOpener());

    expect(await openFromSdk("missing")).toBe(false);

    expect(open).not.toHaveBeenCalled();
  });

  it("refuses another plugin's nav panel", async () => {
    const openPopoutWindow = vi.fn(async () => true);
    installDesktop(openPopoutWindow);

    expect(await openFromSdk("board")).toBe(false);

    expect(openPopoutWindow).not.toHaveBeenCalled();
  });

  it("opens the requested location inside the panel", async () => {
    const openPopoutWindow = vi.fn(async () => true);
    installDesktop(openPopoutWindow);

    expect(
      await openFromSdk("docs", { subPath: "guides/getting started.md" }),
    ).toBe(true);

    expect(openPopoutWindow).toHaveBeenCalledWith({
      path: "/plugins/garden/docs/guides/getting%20started.md?bbWindow=popout",
    });
  });

  it.each([
    "../../orchard/board",
    "../../../settings",
    "guides/../../../orchard/board",
  ])("refuses a subPath that leaves the panel: %s", async (subPath) => {
    const openPopoutWindow = vi.fn(async () => true);
    installDesktop(openPopoutWindow);
    const open = vi.spyOn(window, "open");

    expect(await openFromSdk("docs", { subPath })).toBe(false);

    expect(openPopoutWindow).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a subPath whose dot segments stay inside the panel", async () => {
    const openPopoutWindow = vi.fn(async () => true);
    installDesktop(openPopoutWindow);

    expect(await openFromSdk("docs", { subPath: "guides/../intro.md" })).toBe(
      true,
    );

    expect(openPopoutWindow).toHaveBeenCalledWith({
      path: "/plugins/garden/docs/intro.md?bbWindow=popout",
    });
  });

  it("refuses when the desktop shell fails to open the window", async () => {
    installDesktop(
      vi.fn(async () => {
        throw new Error("closed");
      }),
    );

    expect(await openFromSdk("docs")).toBe(false);
  });
});
