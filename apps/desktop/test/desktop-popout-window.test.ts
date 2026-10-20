import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerDesktopPopoutWindowIpc,
  resolveAppCommandTarget,
  resolvePopoutWindowBounds,
  resolvePopoutWindowUrl,
} from "../src/desktop-popout-window.js";
import { BB_DESKTOP_OPEN_POPOUT_WINDOW_CHANNEL } from "../src/desktop-window-command-ipc.js";

const mock = vi.hoisted(() => {
  interface PopoutIpcFrame {
    url: string;
  }
  interface PopoutIpcEvent {
    sender: { id: number; mainFrame: PopoutIpcFrame };
    senderFrame: PopoutIpcFrame | null;
  }
  type Handler = (event: PopoutIpcEvent, payload: unknown) => Promise<boolean>;
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: mock.handle },
}));

const APP_URL = "http://127.0.0.1:38886";
const SENDER_URL = `${APP_URL}/threads/thr_1`;
const POPOUT_PATH = "/plugins/notes/notes?bbWindow=popout";

describe("resolvePopoutWindowUrl", () => {
  it.each([
    {
      name: "a local app path",
      appUrl: APP_URL,
      path: POPOUT_PATH,
      senderUrl: SENDER_URL,
      expected: `${APP_URL}${POPOUT_PATH}`,
    },
    {
      name: "a remote app URL with its own path and query",
      appUrl: "https://bb.invalid/base/?token=1#start",
      path: "/plugins/notes/notes/today?bbWindow=popout#top",
      senderUrl: "https://bb.invalid/threads/thr_1",
      expected:
        "https://bb.invalid/plugins/notes/notes/today?bbWindow=popout#top",
    },
    {
      name: "encoded slashes that stay on the app origin",
      appUrl: APP_URL,
      path: "/plugins/notes/%2F%2Fbb.invalid",
      senderUrl: SENDER_URL,
      expected: `${APP_URL}/plugins/notes/%2F%2Fbb.invalid`,
    },
  ])("resolves $name", ({ appUrl, path, senderUrl, expected }) => {
    expect(resolvePopoutWindowUrl({ appUrl, path, senderUrl })).toBe(expected);
  });

  it.each([
    { name: "a protocol-relative path", path: "//evil.invalid/plugins" },
    { name: "a backslash host", path: "/\\evil.invalid/plugins" },
    { name: "a tab-smuggled host", path: "/\t/evil.invalid/plugins" },
    { name: "a newline-smuggled host", path: "/\n/evil.invalid/plugins" },
    { name: "a relative path", path: "plugins/notes/notes" },
    { name: "an absolute URL", path: "https://evil.invalid/plugins" },
  ])("rejects $name", ({ path }) => {
    expect(
      resolvePopoutWindowUrl({ appUrl: APP_URL, path, senderUrl: SENDER_URL }),
    ).toBeNull();
  });

  it.each([
    {
      name: "a sender on another host",
      appUrl: APP_URL,
      senderUrl: "https://evil.invalid/threads/thr_1",
    },
    {
      name: "a sender on another port",
      appUrl: APP_URL,
      senderUrl: "http://127.0.0.1:5173/threads/thr_1",
    },
    {
      name: "a sender showing a local error page",
      appUrl: APP_URL,
      senderUrl: "data:text/html;charset=utf-8,error",
    },
    { name: "a missing sender URL", appUrl: APP_URL, senderUrl: null },
    { name: "an unparseable sender URL", appUrl: APP_URL, senderUrl: "bb" },
    { name: "no loaded app", appUrl: null, senderUrl: SENDER_URL },
    {
      name: "a data: app URL",
      appUrl: "data:text/html;charset=utf-8,loading",
      senderUrl: "data:text/html;charset=utf-8,loading",
    },
    {
      name: "a file: app URL",
      appUrl: "file:///Applications/bb.app/index.html",
      senderUrl: "file:///Applications/bb.app/index.html",
    },
  ])("rejects $name", ({ appUrl, senderUrl }) => {
    expect(
      resolvePopoutWindowUrl({ appUrl, path: POPOUT_PATH, senderUrl }),
    ).toBeNull();
  });
});

describe("resolvePopoutWindowBounds", () => {
  const workArea = { height: 900, width: 1440, x: 0, y: 0 };

  it("centers the pop-out on its opener, then offsets it down and right", () => {
    expect(
      resolvePopoutWindowBounds({
        openerBounds: { height: 800, width: 1200, x: 100, y: 50 },
        workArea,
      }),
    ).toEqual({ height: 800, width: 960, x: 252, y: 82 });
  });

  it("keeps the pop-out inside the right and bottom work area edges", () => {
    expect(
      resolvePopoutWindowBounds({
        openerBounds: { height: 800, width: 1200, x: 1000, y: 500 },
        workArea,
      }),
    ).toEqual({ height: 800, width: 960, x: 480, y: 100 });
  });

  it("keeps the pop-out inside the left and top work area edges", () => {
    expect(
      resolvePopoutWindowBounds({
        openerBounds: { height: 600, width: 1000, x: -800, y: -300 },
        workArea,
      }),
    ).toEqual({ height: 800, width: 960, x: 0, y: 0 });
  });

  it("shrinks to a work area smaller than the default size", () => {
    expect(
      resolvePopoutWindowBounds({
        openerBounds: { height: 600, width: 800, x: 0, y: 25 },
        workArea: { height: 600, width: 800, x: 0, y: 25 },
      }),
    ).toEqual({ height: 600, width: 800, x: 0, y: 25 });
  });

  it("stays on a display left of the primary display", () => {
    const leftWorkArea = { height: 1080, width: 1920, x: -1920, y: 0 };
    expect(
      resolvePopoutWindowBounds({
        openerBounds: { height: 900, width: 1400, x: -1800, y: 100 },
        workArea: leftWorkArea,
      }),
    ).toEqual({ height: 800, width: 960, x: -1548, y: 182 });
    expect(
      resolvePopoutWindowBounds({
        openerBounds: { height: 900, width: 1400, x: -700, y: 100 },
        workArea: leftWorkArea,
      }),
    ).toEqual({ height: 800, width: 960, x: -960, y: 182 });
  });
});

describe("resolveAppCommandTarget", () => {
  const standard = { id: "standard" };
  const popout = { id: "popout" };
  const isPopoutWindow = (browserWindow: { id: string }) =>
    browserWindow === popout;

  it("sends to the focused standard window without moving focus", () => {
    expect(
      resolveAppCommandTarget({
        applicationWindows: [popout, standard],
        focusedWindow: standard,
        isPopoutWindow,
      }),
    ).toEqual({ focus: false, kind: "send", window: standard });
  });

  it("sends to a standard window and focuses it while a pop-out is focused", () => {
    expect(
      resolveAppCommandTarget({
        applicationWindows: [popout, standard],
        focusedWindow: popout,
        isPopoutWindow,
      }),
    ).toEqual({ focus: true, kind: "send", window: standard });
  });

  it("asks for a standard window when only pop-outs are open", () => {
    expect(
      resolveAppCommandTarget({
        applicationWindows: [popout],
        focusedWindow: popout,
        isPopoutWindow,
      }),
    ).toEqual({ kind: "open-standard-window" });
  });

  it("does nothing without an app window", () => {
    expect(
      resolveAppCommandTarget({
        applicationWindows: [],
        focusedWindow: null,
        isPopoutWindow,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("desktop pop-out window IPC", () => {
  const open = vi.fn(async () => true);
  let appUrl: string | null = APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    open.mockImplementation(async () => true);
    appUrl = APP_URL;
    registerDesktopPopoutWindowIpc({
      applicationWindowWebContentsIds: new Set([7]),
      getAppUrl: () => appUrl,
      open,
    });
  });

  function createEvent({
    frame = "main",
    frameUrl = SENDER_URL,
    senderId = 7,
  }: {
    frame?: "main" | "sub" | "none";
    frameUrl?: string;
    senderId?: number;
  } = {}) {
    const mainFrame = { url: frameUrl };
    const senderFrames = {
      main: mainFrame,
      none: null,
      sub: { url: frameUrl },
    };
    return {
      sender: { id: senderId, mainFrame },
      senderFrame: senderFrames[frame],
    };
  }

  function request(
    event: ReturnType<typeof createEvent>,
    payload: unknown,
  ): Promise<boolean> {
    const handler = mock.handlers.get(BB_DESKTOP_OPEN_POPOUT_WINDOW_CHANNEL);
    if (handler === undefined) throw new Error("pop-out handler missing");
    return handler(event, payload);
  }

  it("opens the resolved app URL for the sending window and returns the result", async () => {
    const event = createEvent();
    await expect(request(event, { path: POPOUT_PATH })).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith({
      opener: event.sender,
      url: `${APP_URL}${POPOUT_PATH}`,
    });

    open.mockImplementation(async () => false);
    await expect(request(event, { path: POPOUT_PATH })).resolves.toBe(false);
  });

  it.each([
    { name: "another web contents", event: createEvent({ senderId: 99 }) },
    { name: "a subframe", event: createEvent({ frame: "sub" }) },
    { name: "a disposed frame", event: createEvent({ frame: "none" }) },
  ])("rejects requests from $name", async ({ event }) => {
    await expect(request(event, { path: POPOUT_PATH })).rejects.toThrow(
      "Pop-out windows are limited to bb windows",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    { name: "a missing payload", payload: undefined },
    { name: "a bare string", payload: POPOUT_PATH },
    { name: "a relative path", payload: { path: "plugins/notes/notes" } },
    {
      name: "unknown fields",
      payload: { path: POPOUT_PATH, url: "https://evil.invalid/" },
    },
    { name: "a protocol-relative path", payload: { path: "//evil.invalid/" } },
  ])("returns false without opening for $name", async ({ payload }) => {
    await expect(request(createEvent(), payload)).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("returns false without opening while no bb app is loaded", async () => {
    appUrl = null;
    await expect(request(createEvent(), { path: POPOUT_PATH })).resolves.toBe(
      false,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("returns false without opening when the sender left the app origin", async () => {
    await expect(
      request(createEvent({ frameUrl: "https://evil.invalid/" }), {
        path: POPOUT_PATH,
      }),
    ).resolves.toBe(false);
    appUrl = "https://bb.invalid/";
    await expect(request(createEvent(), { path: POPOUT_PATH })).resolves.toBe(
      false,
    );
    expect(open).not.toHaveBeenCalled();
  });
});
