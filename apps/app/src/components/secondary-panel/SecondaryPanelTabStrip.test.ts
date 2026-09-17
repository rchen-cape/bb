// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStrip(
  overrides: Partial<
    Parameters<typeof SecondaryPanelTabStrip>[0]
  > = {},
) {
  return render(
    createElement(
      TooltipProvider,
      null,
      createElement(SecondaryPanelTabStrip, {
        activeTabId: "browser",
        tabs: [
          {
            label: "Browser",
            isPinned: false,
            leadingVisual: null,
            statusLabel: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
            renderContent: () => null,
            tab: { id: "browser", kind: "new-tab" as const },
          },
        ],
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
        isPanelOpen: true,
        ...overrides,
      }),
    ),
  );
}

describe("SecondaryPanelTabStrip", () => {
  it("renders tabs as a vertical, scrollable icon column", () => {
    const { container } = renderStrip();
    const strip = container.querySelector(
      '[data-testid="secondary-panel-tab-strip"]',
    );
    expect(strip).not.toBeNull();
    expect(strip?.className).toContain("flex-col");
    expect(strip?.className).toContain("overflow-y-auto");
  });

  it("selects a tab when its icon is clicked", () => {
    const onSelect = vi.fn();
    const { getByRole } = renderStrip({
      tabs: [
        {
          label: "Browser",
          isPinned: false,
          leadingVisual: null,
          statusLabel: null,
          onSelect,
          onClose: vi.fn(),
          renderContent: () => null,
          tab: { id: "browser", kind: "new-tab" as const },
        },
      ],
    });
    fireEvent.click(getByRole("button", { name: "Browser" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes a non-pinned tab via its close affordance", () => {
    const onClose = vi.fn();
    const { getByRole } = renderStrip({
      tabs: [
        {
          label: "Browser",
          isPinned: false,
          leadingVisual: null,
          statusLabel: null,
          onSelect: vi.fn(),
          onClose,
          renderContent: () => null,
          tab: { id: "browser", kind: "new-tab" as const },
        },
      ],
    });
    fireEvent.click(getByRole("button", { name: "Close Browser" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a color swatch indicator when the tab has a colorTag", () => {
    const { container } = renderStrip({
      tabs: [
        {
          label: "Terminal",
          isPinned: false,
          leadingVisual: null,
          colorTag: "blue",
          statusLabel: null,
          onSelect: vi.fn(),
          onClose: vi.fn(),
          renderContent: () => null,
          tab: {
            colorTag: "blue",
            id: "terminal",
            kind: "terminal" as const,
            terminalId: "terminal",
          },
        },
      ],
    });
    expect(container.querySelector(".bg-timeline-accent")).not.toBeNull();
  });
});
