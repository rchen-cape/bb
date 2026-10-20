// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
} from "@/lib/bb-desktop";
import { writeLastKnownPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  PopoutPluginPanelFallback,
  PopoutPluginPanelHeader,
} from "./PopoutPluginPanelChrome";

const macosDesktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const notesRoute = { pluginId: "notes", panelPath: "notes", subPath: "" };

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
          component: () => <div>Notes body</div>,
          headerContent: () => <button type="button">New note</button>,
        },
      ],
    }),
  );
}

function hasClasses(element: Element, classes: string): boolean {
  return classes
    .split(" ")
    .every((className) => element.classList.contains(className));
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  delete window.bbDesktop;
  window.localStorage.clear();
  document.title = "";
});

describe("pop-out plugin panel chrome", () => {
  it("titles the window from the last-known page while plugins are still booting", async () => {
    writeLastKnownPluginNavPanelChrome([
      {
        pluginId: "notes",
        id: "notes",
        path: "notes",
        title: "Notes",
        icon: "FileText",
      },
    ]);

    render(
      <MemoryRouter>
        <PopoutPluginPanelFallback {...notesRoute} />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("app-page-header-content-row").textContent,
    ).toContain("Notes");
    await waitFor(() => expect(document.title).toBe("Notes"));
  });

  it("keeps plugin header content out of the loading header that renders before the page's providers", () => {
    registerNotesPanel();

    render(
      <MemoryRouter>
        <PopoutPluginPanelFallback {...notesRoute} />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("app-page-header-content-row").textContent,
    ).toContain("Notes");
    expect(screen.queryByRole("button", { name: "New note" })).toBeNull();
  });

  it("renders the plugin's header content once the page owns the header", () => {
    registerNotesPanel();

    render(
      <MemoryRouter>
        <SidebarProvider defaultOpen={false}>
          <PopoutPluginPanelHeader {...notesRoute} rendersPluginHeaderContent />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "New note" })).not.toBeNull();
    expect(
      document.querySelector(
        '[data-plugin-right-panel-toggle-portal="plugin-panel:notes:notes:popout"]',
      ),
    ).not.toBeNull();
  });

  it("makes the header the macOS drag row beside the traffic lights without the collapsed-sidebar reserve", async () => {
    window.bbDesktop = createBbDesktopApi(macosDesktopInfo);

    render(
      <MemoryRouter>
        <PopoutPluginPanelFallback {...notesRoute} />
      </MemoryRouter>,
    );

    const contentRow = screen.getByTestId("app-page-header-content-row");
    const header = contentRow.closest("header");
    if (header === null) throw new Error("expected the page header");
    await waitFor(() =>
      expect(
        hasClasses(header, MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS),
      ).toBe(true),
    );
    expect(header.classList.contains("[-webkit-app-region:drag]")).toBe(true);
    expect(hasClasses(contentRow, MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS)).toBe(
      false,
    );
    expect(hasClasses(contentRow, BROWSER_COLLAPSED_HEADER_RESERVE_CLASS)).toBe(
      false,
    );
  });
});
