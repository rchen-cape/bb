// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import {
  AI_HUB_PANEL_PATH,
  USAGE_REALTIME_CHANNEL,
  type AiHubRpcContract,
  type ContextSummary,
} from "./src/contract.js";
import {
  LAST_BUCKET_INPUT,
  emptyReportFixture,
  reportFixture,
  threadDetailFixture,
} from "./views/test-fixtures.js";
import { STATUS_POLL_MS } from "./views/usage/dashboard.js";
import { REALTIME_REFRESH_MIN_MS } from "./views/use-ai-hub-query.js";

const app = await loadPluginApp(() => import("./app.js"));
const panel = app.navPanels[0]!;

const POINTER_SHIMS = {
  scrollIntoView: () => {},
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
};
const originalPrototype = Object.fromEntries(
  Object.keys(POINTER_SHIMS).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  ]),
);

beforeAll(() => {
  Object.assign(HTMLElement.prototype, POINTER_SHIMS);
});

afterAll(() => {
  for (const [name, descriptor] of Object.entries(originalPrototype)) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    } else {
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function rpc(
  overrides: Partial<PluginRpcTestHandlers<AiHubRpcContract>> = {},
): PluginRpcTestHandlers<AiHubRpcContract> {
  return {
    report: (input) => reportFixture(input),
    threadUsage: () => threadDetailFixture(),
    status: () => reportFixture().coverage,
    rescan: () => ({ queuedThreads: 3 }),
    ...overrides,
  };
}

function render(
  subPath: string,
  options: RenderSlotOptions<AiHubRpcContract> = {},
) {
  return renderSlot<PluginNavPanelProps, AiHubRpcContract>(
    panel,
    { subPath },
    { rpc: rpc(), ...options },
  );
}

type Slot = ReturnType<typeof render>;

function reportCalls(slot: Slot) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "report");
}

async function loaded(slot: Slot) {
  await slot.findByText("Last 30 days · total tokens");
}

async function card(slot: Slot, title: string): Promise<HTMLElement> {
  const heading = await slot.findByRole("heading", { name: title });
  const section = heading.closest("section");
  if (section === null) throw new Error(`no card for ${title}`);
  return section;
}

function reportBody(slot: Slot): Element {
  const body = slot
    .getByText("Last 30 days · total tokens")
    .closest("[aria-busy]");
  if (body === null) throw new Error("no report body");
  return body;
}

const CLAUDE_CONTEXT: ContextSummary = {
  threads: 4,
  averageUsedTokens: 55_000,
  averageWindowTokens: 200_000,
  categories: [
    { label: "Messages", kind: "used", averageTokens: 40_000, threads: 4 },
    { label: "System tools", kind: "used", averageTokens: 12_000, threads: 4 },
    { label: "System prompt", kind: "used", averageTokens: 3_000, threads: 4 },
    {
      label: "MCP tools (deferred)",
      kind: "deferred",
      averageTokens: 8_000,
      threads: 4,
    },
    {
      label: "Autocompact buffer",
      kind: "reserved",
      averageTokens: 33_000,
      threads: 4,
    },
    { label: "Free space", kind: "free", averageTokens: 112_000, threads: 4 },
  ],
  topEntries: [],
};

describe("AI Hub panel", () => {
  it("registers one nav panel with its icon and path", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(panel).toMatchObject({
      id: "ai-hub",
      title: "AI Hub",
      icon: "Brain",
      path: AI_HUB_PANEL_PATH,
    });
    expect(panel.experimental_hideSidebarOnOpen).toBeUndefined();
  });

  it("redirects the bare panel to the usage section without a history entry", async () => {
    const slot = render("");
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toEqual([
        {
          method: "toPluginPanel",
          path: AI_HUB_PANEL_PATH,
          options: { subPath: "usage", replace: true },
        },
      ]),
    );
  });

  it("shows a not-found state for an unknown address", async () => {
    const slot = render("skills/edit");
    await slot.findByText("Page not found");
    fireEvent.click(slot.getByRole("button", { name: "Back to Usage" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: AI_HUB_PANEL_PATH,
      options: { subPath: "usage" },
    });
  });

  it("loads the last 30 days for every project and provider", async () => {
    const slot = render("usage");
    await loaded(slot);
    expect(reportCalls(slot)[0]?.input).toEqual({
      range: "30d",
      projectId: null,
      providerId: null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(
      slot.getByRole("tab", { name: "Usage" }).getAttribute("data-state"),
    ).toBe("active");
  });

  it("re-requests the report when the range changes", async () => {
    const slot = render("usage");
    await loaded(slot);
    fireEvent.click(slot.getByRole("radio", { name: "Last 7 days" }));
    await slot.findByText("Last 7 days · total tokens");
    expect(reportCalls(slot).at(-1)?.input).toMatchObject({ range: "7d" });
  });

  it("filters the report by project", async () => {
    const slot = render("usage");
    await loaded(slot);
    fireEvent.click(slot.getByRole("combobox", { name: "Project" }));
    const option = await slot.findByRole("option", { name: "API server" });
    fireEvent.click(option);
    await waitFor(() =>
      expect(reportCalls(slot).at(-1)?.input).toMatchObject({
        projectId: "proj_api",
        providerId: null,
      }),
    );
  });

  it("refetches when a realtime usage signal arrives", async () => {
    const slot = render("usage");
    await loaded(slot);
    const before = reportCalls(slot).length;
    await slot.behavior.emitRealtime(USAGE_REALTIME_CHANNEL, {
      threadId: "thr_login",
    });
    await waitFor(() => expect(reportCalls(slot)).toHaveLength(before + 1));
  });

  it("ignores a slower response for filters that were already changed", async () => {
    const pending: (() => void)[] = [];
    const slot = render("usage", {
      rpc: rpc({
        report: (input) =>
          new Promise((resolve) => {
            pending.push(() => resolve(reportFixture(input)));
          }),
      }),
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]?.();
    await loaded(slot);
    fireEvent.click(slot.getByRole("radio", { name: "Last 7 days" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    fireEvent.click(slot.getByRole("radio", { name: "Last 90 days" }));
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[2]?.();
    await slot.findByText("Last 90 days · total tokens");
    pending[1]?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.queryByText("Last 7 days · total tokens")).toBeNull();
    slot.getByText("Last 90 days · total tokens");
  });

  it("coalesces realtime signals that arrive during a request", async () => {
    const pending: (() => void)[] = [];
    const slot = render("usage", {
      rpc: rpc({
        report: (input) =>
          new Promise((resolve) => {
            pending.push(() => resolve(reportFixture(input)));
          }),
      }),
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]?.();
    await loaded(slot);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await slot.behavior.emitRealtime(USAGE_REALTIME_CHANNEL, {});
    expect(pending).toHaveLength(2);
    await slot.behavior.emitRealtime(USAGE_REALTIME_CHANNEL, {});
    await slot.behavior.emitRealtime(USAGE_REALTIME_CHANNEL, {});
    pending[1]?.();
    await vi.advanceTimersByTimeAsync(REALTIME_REFRESH_MIN_MS - 1);
    expect(pending).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending).toHaveLength(3);
    pending[2]?.();
    await vi.advanceTimersByTimeAsync(REALTIME_REFRESH_MIN_MS);
    expect(pending).toHaveLength(3);
  });

  it("refetches after the realtime connection comes back", async () => {
    const slot = render("usage", { realtimeConnectionState: "reconnecting" });
    await loaded(slot);
    const before = reportCalls(slot).length;
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(reportCalls(slot)).toHaveLength(before + 1));
  });

  it("opens a top thread's usage page", async () => {
    const slot = render("usage");
    await loaded(slot);
    fireEvent.click(slot.getByRole("button", { name: "Fix login redirect" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: AI_HUB_PANEL_PATH,
      options: { subPath: "usage/thread/thr_login" },
    });
  });

  it("opens the thread itself, but not a deleted one", async () => {
    const slot = render("usage");
    await loaded(slot);
    fireEvent.click(
      slot.getByRole("button", { name: "Open thread Fix login redirect" }),
    );
    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toThread", threadId: "thr_login" }),
    );
    expect(
      (
        slot.getByRole("button", {
          name: "Open thread Write API docs",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("switches the usage chart to a table of the timeline", async () => {
    const slot = render("usage");
    await loaded(slot);
    const timeline = await card(slot, "Usage over time");
    expect(within(timeline).queryByRole("table")).toBeNull();
    fireEvent.click(within(timeline).getByRole("radio", { name: "Table" }));
    const table = within(timeline).getByRole("table", {
      name: "Usage over time",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    within(table).getByText(LAST_BUCKET_INPUT.toLocaleString("en-US"));
  });

  it("colors the chart from bb's dark theme", async () => {
    const slot = render("usage", { codeTheme: { mode: "dark" } });
    await loaded(slot);
    const timeline = await card(slot, "Usage over time");
    const legend = within(timeline).getByRole("list", { name: "Legend" });
    const swatch = legend.querySelector("span");
    expect(swatch?.style.backgroundColor).toBe("rgb(57, 135, 229)");
  });

  it("explains an empty range and shows indexing progress", async () => {
    const slot = render("usage", {
      rpc: rpc({ report: (input) => emptyReportFixture(input) }),
    });
    await slot.findByText("No token usage recorded in this range");
    expect(slot.getAllByText("Syncing 12 threads…").length).toBeGreaterThan(0);
    expect(slot.queryByRole("heading", { name: "Usage over time" })).toBeNull();
  });

  it("takes sync progress from the status poll but keeps the filtered estimate", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const indexing = {
      ...reportFixture().coverage,
      scanning: true,
      pendingThreads: 3,
    };
    const slot = render("usage", {
      rpc: rpc({
        report: (input) => ({ ...reportFixture(input), coverage: indexing }),
        status: () => ({
          ...indexing,
          backfilledTokens: 50_000_000,
          indexedThreads: 44,
          pendingThreads: 1,
        }),
      }),
    });
    await loaded(slot);
    await slot.findByText("Syncing 3 threads…");
    const estimate = () =>
      slot.getByRole("button", { name: /estimated/ }).textContent;
    expect(estimate()).toContain("· 5% estimated");
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);
    await slot.findByText("Syncing 1 thread…");
    expect(estimate()).toContain("· 5% estimated");
  });

  it("stacks only loaded context against the window and lists deferred tools apart", async () => {
    const slot = render("usage", {
      rpc: rpc({
        report: (input) => ({
          ...reportFixture(input),
          context: CLAUDE_CONTEXT,
        }),
      }),
    });
    await loaded(slot);
    const context = await card(slot, "Context overhead");
    within(context).getByText(
      "Average across the latest context snapshot of 4 threads",
    );
    within(context).getByText(
      "55K tokens in context on average of a 200K window",
    );
    expect(
      within(context)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Messages40K20%", "System tools12K6%", "System prompt3K2%"]);
    expect(
      Array.from(context.querySelectorAll<HTMLElement>("[style]"))
        .map((element) => element.style.flexGrow)
        .filter((grow) => grow !== ""),
    ).toEqual(["40000", "12000", "3000", "145000"]);
    within(context).getByText("Deferred, not loaded: MCP tools 8K");
    expect(within(context).queryByText(/Autocompact buffer/)).toBeNull();
    fireEvent.click(within(context).getByRole("radio", { name: "Table" }));
    const table = within(context).getByRole("table", {
      name: "Average context by category",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    within(context).getByText("Deferred, not loaded: MCP tools 8K");
  });

  it("keeps the old report dimmed when the report for new filters fails", async () => {
    const slot = render("usage", {
      rpc: rpc({
        report: (input) => {
          if (input.projectId !== null) throw new Error("database is locked");
          return reportFixture(input);
        },
      }),
    });
    await loaded(slot);
    expect(reportBody(slot).getAttribute("aria-busy")).toBe("false");
    fireEvent.click(slot.getByRole("combobox", { name: "Project" }));
    fireEvent.click(await slot.findByRole("option", { name: "API server" }));
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("database is locked");
    expect(reportBody(slot).getAttribute("aria-busy")).toBe("true");
    expect(reportBody(slot).className).toContain("opacity-60");
  });

  it("keeps a report at full opacity when only its refresh fails", async () => {
    let attempts = 0;
    const slot = render("usage", {
      rpc: rpc({
        report: (input) => {
          attempts += 1;
          if (attempts > 1) throw new Error("database is locked");
          return reportFixture(input);
        },
      }),
    });
    await loaded(slot);
    await slot.behavior.emitRealtime(USAGE_REALTIME_CHANNEL, {});
    await slot.findByRole("alert");
    expect(reportBody(slot).getAttribute("aria-busy")).toBe("false");
    expect(reportBody(slot).className).not.toContain("opacity-60");
  });

  it("explains that estimates are dated to the snapshot they came from", async () => {
    const slot = render("usage");
    await loaded(slot);
    try {
      fireEvent.keyDown(document.body, { key: "Tab" });
      fireEvent.focus(slot.getByRole("button", { name: /Tracking since/ }));
      const tooltip = await slot.findByRole("tooltip");
      expect(tooltip.textContent).toContain(
        "are estimated from that snapshot and dated to when it was taken, not to the turns that used them.",
      );
    } finally {
      fireEvent.pointerDown(document.body);
    }
  });

  it("shows a load error and retries", async () => {
    let attempts = 0;
    const slot = render("usage", {
      rpc: rpc({
        report: (input) => {
          attempts += 1;
          if (attempts === 1) throw new Error("database is locked");
          return reportFixture(input);
        },
      }),
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("database is locked");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await loaded(slot);
    expect(slot.queryByRole("alert")).toBeNull();
    expect(attempts).toBe(2);
  });

  it("queues a rescan and refreshes the report", async () => {
    const slot = render("usage");
    await loaded(slot);
    const before = reportCalls(slot).length;
    fireEvent.click(slot.getByRole("button", { name: "Rescan" }));
    await waitFor(() => expect(reportCalls(slot)).toHaveLength(before + 1));
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "rescan",
      input: null,
    });
  });

  it("shows a thread's entries, with estimated ones marked", async () => {
    const slot = render("usage/thread/thr_login");
    await slot.findByRole("heading", { name: "Fix login redirect" });
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "threadUsage",
      input: { threadId: "thr_login" },
    });
    const table = slot.getByRole("table", { name: "Usage entries" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    within(table).getByText("Estimated");
    within(table).getByText("Live · subagent");
    slot.getByRole("table", { name: "Subagent tasks" });
    fireEvent.click(slot.getByRole("button", { name: "Open thread" }));
    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toThread", threadId: "thr_login" }),
    );
  });

  it("decodes the thread id from the address", async () => {
    const slot = render("usage/thread/thr_%C3%A9");
    await slot.findByRole("heading", { name: "Fix login redirect" });
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "threadUsage",
      input: { threadId: "thr_é" },
    });
  });

  it("shows not-found for a thread without usage", async () => {
    const slot = render("usage/thread/thr_missing", {
      rpc: rpc({ threadUsage: () => null }),
    });
    await slot.findByText("No usage for this thread");
    fireEvent.click(slot.getByRole("button", { name: "Back to Usage" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: AI_HUB_PANEL_PATH,
      options: { subPath: "usage" },
    });
  });
});
