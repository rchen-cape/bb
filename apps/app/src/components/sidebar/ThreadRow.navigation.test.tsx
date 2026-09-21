// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { DndContext } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  SidebarThreadShortcutKeysContext,
} from "./sidebarThreadShortcuts";
import {
  resetSidebarTitleDoubleClickForTest,
  ThreadRow,
  type ThreadRowOptions,
} from "./ThreadRow";

const mocks = vi.hoisted(() => ({ renameThread: vi.fn() }));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({ renameThread: mocks.renameThread }),
}));

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsContextMenu: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ThreadActionsMenu: () => <button type="button">Thread actions</button>,
  ThreadArchiveQuickAction: () => <button type="button">Archive</button>,
}));

const EMPTY_MAP = new Map();

const OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  hideBranchName: false,
};

function makeRow(id: string, title: string): ThreadListEntry {
  return makeThreadListEntry({
    id,
    projectId: "proj_1",
    title,
    titleFallback: title,
    environmentBranchName: "bb/branch",
    status: "idle",
    updatedAt: Date.now() - 60_000,
    statusChangedAt: Date.now() - 60_000,
  });
}

const ALPHA = makeRow("thr_alpha", "Alpha thread");
const BRAVO = makeRow("thr_bravo", "Bravo thread");

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route">{location.pathname}</div>;
}

function renderSidebar() {
  const view = render(
    <MemoryRouter
      initialEntries={[
        getThreadRoutePath({ projectId: "proj_1", threadId: ALPHA.id }),
      ]}
    >
      <TooltipProvider>
        <ThreadTitleMentionResourcesProvider
          sectionNamesById={EMPTY_MAP}
          projectNamesById={EMPTY_MAP}
          threadById={EMPTY_MAP}
        >
          <SidebarThreadShortcutKeysContext.Provider
            value={EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS}
          >
            <RouteProbe />
            {[ALPHA, BRAVO].map((thread) => (
              <ThreadRow
                key={thread.id}
                projectId="proj_1"
                thread={thread}
                crossProjectId={null}
                isActive={thread.id === ALPHA.id}
                hasComposerDraft={false}
                options={
                  thread.id === BRAVO.id
                    ? OPTIONS
                    : { ...OPTIONS, kind: "default" }
                }
              />
            ))}
          </SidebarThreadShortcutKeysContext.Provider>
        </ThreadTitleMentionResourcesProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return {
    ...view,
    route: () => screen.getByTestId("route").textContent,
    rowFor: (thread: ThreadListEntry) =>
      document.querySelector<HTMLElement>(
        `[data-sidebar-thread-id="${thread.id}"]`,
      )!,
    containerFor: (thread: ThreadListEntry) =>
      document
        .querySelector(`[data-sidebar-thread-id="${thread.id}"]`)!
        .closest<HTMLElement>("[data-sidebar-thread-row]")!,
  };
}

const BRAVO_ROUTE = getThreadRoutePath({
  projectId: "proj_1",
  threadId: BRAVO.id,
});

afterEach(() => {
  cleanup();
  resetSidebarTitleDoubleClickForTest();
  mocks.renameThread.mockClear();
});

describe("switching threads in the sidebar", () => {
  it("navigates on a plain click", () => {
    const view = renderSidebar();
    fireEvent.click(view.rowFor(BRAVO));
    expect(view.route()).toBe(BRAVO_ROUTE);
  });

  it("navigates when the press drifts within the activation budget", () => {
    const view = renderSidebar();
    const link = view.rowFor(BRAVO);
    fireEvent.mouseDown(link, { button: 0, clientX: 40, clientY: 80 });
    fireEvent.mouseMove(document, { clientX: 46, clientY: 80 });
    fireEvent.mouseUp(link, { button: 0, clientX: 46, clientY: 80 });
    fireEvent.click(link, { clientX: 46, clientY: 80 });
    expect(view.route()).toBe(BRAVO_ROUTE);
  });

  it("navigates on the second click when an impatient user clicks twice", () => {
    const view = renderSidebar();
    const link = view.rowFor(BRAVO);
    fireEvent.click(link);
    fireEvent.click(link);
    expect(view.route()).toBe(BRAVO_ROUTE);
    expect(mocks.renameThread).not.toHaveBeenCalled();
    expect(
      document.querySelector("input,textarea,[contenteditable]"),
    ).toBeNull();
  });

  /*
   * The hover-actions overlay is anchored to a slot narrower than itself, so it
   * reaches back over the row's text. jsdom honours neither hit testing nor
   * pointer-events, so this asserts the arrangement that keeps its dead
   * pixels — the padding, and the gap between the two buttons — from taking a
   * click that belongs to the row underneath.
   */
  it("lets clicks fall through the hover-actions overlay to the row", () => {
    const view = renderSidebar();
    const actions = view
      .containerFor(BRAVO)
      .querySelector<HTMLElement>(".bb-sidebar-hover-actions")!;
    const classes = Array.from(actions.classList);
    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("[&_button]:pointer-events-auto");
    expect(actions.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  /*
   * The row's link is absolutely positioned over the whole row, so the browser
   * hit-tests it above the row's own text and a click anywhere in the text
   * lands on the link. jsdom has no hit testing, so this asserts the structural
   * property that keeps that true: the text a pointer aims at must not lift
   * itself above the link with its own stacking or pointer-events.
   */
  it.each([
    ["the activity time", "[data-sidebar-thread-activity-time]"],
    ["the branch line", "[data-sidebar-thread-meta]"],
    ["the title", ".bb-thread-title"],
  ])("keeps %s underneath the row link", (_label, selector) => {
    const view = renderSidebar();
    const container = view.containerFor(BRAVO);
    let element = container.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    while (element !== null && element !== container) {
      const classes = Array.from(element.classList);
      expect(classes).not.toContain("pointer-events-auto");
      expect(classes.filter((name) => name.startsWith("z-"))).toEqual([]);
      expect(classes).not.toContain("absolute");
      element = element.parentElement;
    }
  });

  it("navigates while the row is re-rendering on its clock tick", () => {
    vi.useFakeTimers();
    try {
      const view = renderSidebar();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      fireEvent.click(view.rowFor(BRAVO));
      expect(view.route()).toBe(BRAVO_ROUTE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates to each thread in turn when alternating quickly", () => {
    const view = renderSidebar();
    const alphaRoute = getThreadRoutePath({
      projectId: "proj_1",
      threadId: ALPHA.id,
    });
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(view.rowFor(BRAVO));
      expect(view.route()).toBe(BRAVO_ROUTE);
      fireEvent.click(view.rowFor(ALPHA));
      expect(view.route()).toBe(alphaRoute);
    }
  });
});

/*
 * The sidebar wires every row into a drag context and hands it the click
 * suppression that keeps a finished drag from navigating. That plumbing is
 * where a click is most easily lost, so these drive it end to end rather than
 * rendering a row on its own.
 */
describe("switching threads while rows are drag-enabled", () => {
  function DraggableRow({
    thread,
    isActive,
    consumeClickSuppression,
  }: {
    thread: ThreadListEntry;
    isActive: boolean;
    consumeClickSuppression: () => boolean;
  }) {
    const { attributes, listeners, setActivatorNodeRef } = useSortable({
      id: thread.id,
    });
    return (
      <ThreadRow
        projectId="proj_1"
        thread={thread}
        crossProjectId={null}
        isActive={isActive}
        hasComposerDraft={false}
        options={{
          ...OPTIONS,
          consumeClickSuppression,
          dragBindings: {
            attributes,
            disabled: false,
            listeners,
            setActivatorNodeRef,
          },
        }}
      />
    );
  }

  function DragHarness() {
    const { dndContextProps, consumeClickSuppression } = useSidebarReorderDnd({
      onDragEnd: () => {},
    });
    return (
      <DndContext {...dndContextProps}>
        <RouteProbe />
        {[ALPHA, BRAVO].map((thread) => (
          <DraggableRow
            key={thread.id}
            thread={thread}
            isActive={thread.id === ALPHA.id}
            consumeClickSuppression={consumeClickSuppression}
          />
        ))}
      </DndContext>
    );
  }

  function renderDragSidebar() {
    render(
      <MemoryRouter
        initialEntries={[
          getThreadRoutePath({ projectId: "proj_1", threadId: ALPHA.id }),
        ]}
      >
        <TooltipProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={EMPTY_MAP}
            projectNamesById={EMPTY_MAP}
            threadById={EMPTY_MAP}
          >
            <SidebarThreadShortcutKeysContext.Provider
              value={EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS}
            >
              <DragHarness />
            </SidebarThreadShortcutKeysContext.Provider>
          </ThreadTitleMentionResourcesProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );
    return {
      route: () => screen.getByTestId("route").textContent,
      linkFor: (thread: ThreadListEntry) =>
        document.querySelector<HTMLElement>(
          `[data-sidebar-thread-id="${thread.id}"]`,
        )!,
    };
  }

  function pressAndRelease(target: HTMLElement, drift: number) {
    fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
    if (drift > 0) {
      fireEvent.mouseMove(document, { clientX: 100 + drift, clientY: 100 });
    }
    fireEvent.mouseUp(target, {
      button: 0,
      clientX: 100 + drift,
      clientY: 100,
    });
    fireEvent.click(target, { clientX: 100 + drift, clientY: 100 });
  }

  it.each([0, 1, 2, 3, 5, 7])(
    "navigates when a click drifts %ipx, inside the drag budget",
    (drift) => {
      const view = renderDragSidebar();
      pressAndRelease(view.linkFor(BRAVO), drift);
      expect(view.route()).toBe(BRAVO_ROUTE);
    },
  );

  it("treats travel past the budget as a drag and does not navigate", () => {
    const view = renderDragSidebar();
    const alphaRoute = getThreadRoutePath({
      projectId: "proj_1",
      threadId: ALPHA.id,
    });
    pressAndRelease(view.linkFor(BRAVO), 40);
    expect(view.route()).toBe(alphaRoute);
  });

  /*
   * dnd-kit itself parks a capture-phase click suppressor on the document for
   * 50ms after a drag detaches, which no application code can shorten. Our own
   * suppression used to add 350ms on top of that, and a drag that ended without
   * producing a click left it armed for the whole window — so a deliberate
   * click on another thread died and the previous one stayed open. Past the
   * upstream window, the next click has to land.
   */
  it("still navigates after a drag that ended without a click of its own", () => {
    vi.useFakeTimers();
    try {
      const view = renderDragSidebar();
      fireEvent.mouseDown(view.linkFor(ALPHA), {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.mouseMove(document, { clientX: 160, clientY: 100 });
      fireEvent.mouseUp(document, { button: 0, clientX: 160, clientY: 100 });

      act(() => {
        vi.advanceTimersByTime(60);
      });

      pressAndRelease(view.linkFor(BRAVO), 0);
      expect(view.route()).toBe(BRAVO_ROUTE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates to each thread in turn when alternating quickly", () => {
    const view = renderDragSidebar();
    const alphaRoute = getThreadRoutePath({
      projectId: "proj_1",
      threadId: ALPHA.id,
    });
    for (let round = 0; round < 3; round += 1) {
      pressAndRelease(view.linkFor(BRAVO), 2);
      expect(view.route()).toBe(BRAVO_ROUTE);
      pressAndRelease(view.linkFor(ALPHA), 2);
      expect(view.route()).toBe(alphaRoute);
    }
  });
});
