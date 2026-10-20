import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDesktopWindowFactory,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowOpenHandler,
  type DesktopWindowOpenDevToolsOptions,
  type DesktopWindowWebContents,
  macosTrafficLightPosition,
} from "../src/desktop-window-factory.js";
import type { DesktopContextMenuWebContents } from "../src/desktop-context-menu.js";
import { readPersistedWindowStateEntries } from "../src/window-state.js";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type WindowBounds,
  type WindowStateKey,
} from "../src/types.js";

interface TempDir {
  path: string;
}

interface FakeDesktopWindowArgs {
  options: BrowserWindowConstructorOptions;
}

const tempDirs: TempDir[] = [];

async function createTempDir(): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), "bb-desktop-window-factory-"));
  const tempDir = { path };
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir !== undefined) {
      await rm(tempDir.path, { force: true, recursive: true });
    }
  }
});

class FakeDesktopWindowWebContents implements DesktopWindowWebContents {
  public devToolsOpenCount = 0;
  public id: number;
  public readonly addedDictionaryWords: string[] = [];
  public readonly spellCheckerEnabledValues: boolean[] = [];
  public readonly session: DesktopContextMenuWebContents["session"] = {
    addWordToSpellCheckerDictionary: (word) => {
      this.addedDictionaryWords.push(word);
      return true;
    },
    setSpellCheckerEnabled: (enabled) => {
      this.spellCheckerEnabledValues.push(enabled);
    },
  };
  public readonly contextMenuListeners: Parameters<
    DesktopContextMenuWebContents["on"]
  >[1][] = [];
  public readonly replacedMisspellings: string[] = [];
  public windowOpenHandler: DesktopWindowOpenHandler | null = null;
  public readonly zoomFactors: number[] = [];
  public readonly themeColorListeners: Array<
    (event: Event, color: string | null) => void
  > = [];

  constructor(id: number) {
    this.id = id;
  }

  openDevTools(options: DesktopWindowOpenDevToolsOptions): void {
    if (options.mode === "detach") {
      this.devToolsOpenCount += 1;
    }
  }

  on(...args: Parameters<DesktopContextMenuWebContents["on"]>): void;
  on(
    eventName: "did-change-theme-color",
    listener: (event: Event, color: string | null) => void,
  ): void;
  on(
    ...args:
      | Parameters<DesktopContextMenuWebContents["on"]>
      | ["did-change-theme-color", (event: Event, color: string | null) => void]
  ): void {
    const [eventName, listener] = args;
    if (eventName === "context-menu") {
      this.contextMenuListeners.push(listener);
    } else {
      this.themeColorListeners.push(listener);
    }
  }

  replaceMisspelling(text: string): void {
    this.replacedMisspellings.push(text);
  }

  setWindowOpenHandler(handler: DesktopWindowOpenHandler): void {
    this.windowOpenHandler = handler;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactors.push(factor);
  }
}

class FakeDesktopWindow implements DesktopBrowserWindow {
  public readonly id: number;
  public readonly loadedUrls: string[] = [];
  public readonly options: BrowserWindowConstructorOptions;
  public readonly webContents: FakeDesktopWindowWebContents;
  public backgroundColor: string;
  public closeCount = 0;
  public focusCount = 0;
  public fullScreen = false;
  public loadError: Error | null = null;
  public maximized = false;
  public minimized = false;
  public shown = false;
  private destroyed = false;
  private readonly bounds: WindowBounds;
  private readonly closedListeners: Array<() => void> = [];
  private readyToShowListener: (() => void) | null = null;

  constructor(args: FakeDesktopWindowArgs) {
    this.options = args.options;
    this.backgroundColor = args.options.backgroundColor ?? "#ffffff";
    this.id = FakeDesktopWindow.nextWindowId;
    FakeDesktopWindow.nextWindowId += 1;
    this.webContents = new FakeDesktopWindowWebContents(
      FakeDesktopWindow.nextWebContentsId,
    );
    FakeDesktopWindow.nextWebContentsId += 1;
    this.bounds = {
      height: args.options.height ?? 0,
      width: args.options.width ?? 0,
      x: args.options.x ?? 0,
      y: args.options.y ?? 0,
    };
  }

  private static nextWindowId = 1;
  private static nextWebContentsId = 1;

  emitClosed(): void {
    this.destroyed = true;
    for (const listener of this.closedListeners) {
      listener();
    }
  }

  emitReadyToShow(): void {
    this.readyToShowListener?.();
  }

  close(): void {
    this.closeCount += 1;
    this.emitClosed();
  }

  focus(): void {
    this.focusCount += 1;
  }

  getBounds(): WindowBounds {
    return this.bounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    if (this.loadError !== null) {
      throw this.loadError;
    }
  }

  maximize(): void {
    this.maximized = true;
  }

  on(
    eventName: "close" | "closed" | "enter-full-screen" | "leave-full-screen",
    listener: () => void,
  ): void {
    if (eventName === "closed") {
      this.closedListeners.push(listener);
    }
  }

  once(eventName: "ready-to-show", listener: () => void): void {
    if (eventName === "ready-to-show") {
      this.readyToShowListener = listener;
    }
  }

  restore(): void {
    this.minimized = false;
  }

  setBackgroundColor(color: string): void {
    this.backgroundColor = color;
  }

  setFullScreen(isFullScreen: boolean): void {
    this.fullScreen = isFullScreen;
  }

  show(): void {
    this.shown = true;
  }
}

interface FactoryHarness {
  createdWindows: FakeDesktopWindow[];
  factory: ReturnType<typeof createDesktopWindowFactory>;
  userDataPath: string;
}

async function createFactoryHarness(
  overrides: Partial<Parameters<typeof createDesktopWindowFactory>[0]> = {},
): Promise<FactoryHarness> {
  const tempDir = await createTempDir();
  const createdWindows: FakeDesktopWindow[] = [];
  const browserWindowCreator: DesktopBrowserWindowCreator = {
    create(options) {
      const browserWindow = new FakeDesktopWindow({ options });
      createdWindows.push(browserWindow);
      return browserWindow;
    },
  };
  const factory = createDesktopWindowFactory({
    browserWindowCreator,
    createWindowStateKey() {
      return "window-fallback";
    },
    displayWorkAreas: [{ height: 900, width: 1440, x: 0, y: 0 }],
    icon: undefined,
    isMac: true,
    isLinuxTransparent: false,
    isLinuxFrameless: false,
    shouldUseDarkColors() {
      return true;
    },
    isQuitting() {
      return false;
    },
    openExternalUrl() {},
    preloadPath: "/tmp/preload.cjs",
    userDataPath: tempDir.path,
    ...overrides,
  });
  return { createdWindows, factory, userDataPath: tempDir.path };
}

describe("desktop window factory", () => {
  it.each([true, false])(
    "matches each window's page color without resetting on missing metadata (dark: %s)",
    async (dark) => {
      const { createdWindows, factory } = await createFactoryHarness({
        shouldUseDarkColors: () => dark,
      });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      const [first, second] = createdWindows;
      if (!first || !second) throw new Error("Expected two windows");
      expect(first.backgroundColor).toBe(dark ? "#151515" : "#ffffff");
      for (const color of ["#151515", "#ffffff", "#29344a", null]) {
        for (const listener of first.webContents.themeColorListeners) {
          listener(new Event("did-change-theme-color"), color);
        }
        expect(first.backgroundColor).toBe(color ?? "#29344a");
        expect(second.backgroundColor).toBe(dark ? "#151515" : "#ffffff");
      }
    },
  );

  it("preserves transparent Linux backgrounds when the page supplies an opaque theme color", async () => {
    const { createdWindows, factory } = await createFactoryHarness({
      isMac: false,
      isLinuxTransparent: true,
    });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0];
    if (!window) throw new Error("Expected a window");
    for (const listener of window.webContents.themeColorListeners) {
      listener(new Event("did-change-theme-color"), "#29344a");
    }
    expect(window.backgroundColor).toBe("#00000000");
  });

  it("creates distinct windows that load the same URL", async () => {
    const generatedStateKeys: WindowStateKey[] = ["window-second"];
    const { createdWindows, factory, userDataPath } =
      await createFactoryHarness({
        createWindowStateKey() {
          return generatedStateKeys.shift() ?? "window-fallback";
        },
      });

    const firstWindow = await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });
    const secondWindow = await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });

    expect(firstWindow).not.toBe(secondWindow);
    expect(createdWindows).toHaveLength(2);
    expect(createdWindows[0]?.options.frame).toBe(false);
    expect(createdWindows[0]?.options.minHeight).toBe(MIN_WINDOW_HEIGHT);
    expect(createdWindows[0]?.options.minWidth).toBe(MIN_WINDOW_WIDTH);
    expect(createdWindows[0]?.options.titleBarStyle).toBe("hiddenInset");
    expect(createdWindows[0]?.options).not.toHaveProperty("autoHideMenuBar");
    expect(createdWindows[0]?.options.webPreferences?.spellcheck).toBe(true);
    expect(createdWindows[0]?.webContents.spellCheckerEnabledValues).toEqual([
      true,
    ]);
    expect(createdWindows[0]?.options.trafficLightPosition).toEqual({
      x: 18,
      y: 18,
    });
    expect(createdWindows[0]?.loadedUrls).toEqual(["http://127.0.0.1:38886"]);
    expect(createdWindows[1]?.loadedUrls).toEqual(["http://127.0.0.1:38886"]);
    expect(createdWindows[0]?.webContents.zoomFactors).toEqual([1]);
    expect(createdWindows[1]?.webContents.zoomFactors).toEqual([1]);

    await factory.persistOpenWindows();
    await expect(
      readPersistedWindowStateEntries({ userDataPath }),
    ).resolves.toEqual([
      {
        bounds: {
          height: 900,
          width: 1280,
          x: 80,
          y: 80,
        },
        isFullScreen: false,
        isMaximized: false,
        stateKey: "main",
      },
      {
        bounds: {
          height: 900,
          width: 1280,
          x: 80,
          y: 80,
        },
        isFullScreen: false,
        isMaximized: false,
        stateKey: "window-second",
      },
    ]);
  });

  it("allocates distinct state keys for concurrent implicit windows", async () => {
    const generatedStateKeys: WindowStateKey[] = ["window-concurrent"];
    const { createdWindows, factory, userDataPath } =
      await createFactoryHarness({
        createWindowStateKey() {
          return generatedStateKeys.shift() ?? "window-fallback";
        },
      });

    const [firstWindow, secondWindow] = await Promise.all([
      factory.createWindow({
        initialUrl: "http://127.0.0.1:38886",
        stateKey: null,
      }),
      factory.createWindow({
        initialUrl: "http://127.0.0.1:38886",
        stateKey: null,
      }),
    ]);

    expect(firstWindow).not.toBe(secondWindow);
    expect(createdWindows).toHaveLength(2);

    await factory.persistOpenWindows();
    const persistedEntries = await readPersistedWindowStateEntries({
      userDataPath,
    });
    const stateKeys = persistedEntries.map((entry) => entry.stateKey);

    expect(new Set(stateKeys)).toEqual(new Set(["main", "window-concurrent"]));
    expect(new Set(stateKeys).size).toBe(2);
  });

  it("opens only policy-approved blank-target links externally and denies every popup", async () => {
    const openedExternalUrls: string[] = [];
    const { createdWindows, factory } = await createFactoryHarness({
      openExternalUrl({ url }) {
        openedExternalUrls.push(url);
      },
    });

    await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });
    const browserWindow = createdWindows[0];
    if (!browserWindow) {
      throw new Error("Expected desktop window");
    }
    const handler = browserWindow.webContents.windowOpenHandler;
    if (!handler) {
      throw new Error("Expected window open handler");
    }

    const results = [
      "https://example.com/from-markdown",
      "devin://file/Users/me/.bb/artifacts/thr_1/review.diff",
      "javascript:alert(1)",
      "file:///System/Applications/Chess.app",
      "http://127.0.0.1:38886/threads/thr_1",
    ].map((url) => handler({ url }));

    expect(createdWindows).toHaveLength(1);
    expect(openedExternalUrls).toEqual([
      "https://example.com/from-markdown",
      "http://127.0.0.1:38886/threads/thr_1",
    ]);
    expect(new Set(results.map((result) => result.action))).toEqual(
      new Set(["deny"]),
    );
  });

  it.each([
    {
      name: "keeps the native frame",
      isLinuxFrameless: false,
      isLinuxTransparent: false,
      present: { autoHideMenuBar: true },
      absent: ["frame", "titleBarStyle", "trafficLightPosition"],
    },
    {
      name: "enables transparency when requested",
      isLinuxFrameless: false,
      isLinuxTransparent: true,
      present: {
        autoHideMenuBar: true,
        transparent: true,
        backgroundColor: "#00000000",
      },
      absent: ["frame"],
    },
    {
      name: "removes the native frame when requested",
      isLinuxFrameless: true,
      isLinuxTransparent: false,
      present: { autoHideMenuBar: true, frame: false },
      absent: ["titleBarStyle", "trafficLightPosition"],
    },
  ])(
    "$name for Linux windows",
    async ({ isLinuxFrameless, isLinuxTransparent, present, absent }) => {
      const { createdWindows, factory } = await createFactoryHarness({
        isMac: false,
        isLinuxTransparent,
        isLinuxFrameless,
      });

      await factory.createWindow({ initialUrl: null, stateKey: null });

      const options = createdWindows[0]?.options;
      expect(options).toMatchObject(present);
      for (const key of absent) {
        expect(options).not.toHaveProperty(key);
      }
    },
  );
});

describe("desktop pop-out windows", () => {
  const appUrl = "http://127.0.0.1:38886";
  const popoutUrl = `${appUrl}/plugins/notes/notes?bbWindow=popout`;
  const popoutBounds = { height: 800, width: 960, x: 252, y: 82 };

  async function waitForPendingWindowStateWrites(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it("opens at the requested bounds and URL with the standard window setup", async () => {
    const openedExternalUrls: string[] = [];
    const { createdWindows, factory } = await createFactoryHarness({
      openExternalUrl({ url }) {
        openedExternalUrls.push(url);
      },
    });

    await factory.createWindow({ initialUrl: appUrl, stateKey: null });
    const popout = await factory.createPopoutWindow({
      bounds: popoutBounds,
      url: popoutUrl,
    });
    const [standard, popoutWindow] = createdWindows;
    if (!standard || !popoutWindow) throw new Error("Expected two windows");

    expect(popout).toBe(popoutWindow);
    expect(popoutWindow.getBounds()).toEqual(popoutBounds);
    expect({ ...popoutWindow.options, ...popoutBounds }).toEqual({
      ...standard.options,
      ...popoutBounds,
    });
    expect(popoutWindow.loadedUrls).toEqual([popoutUrl]);
    expect(popoutWindow.webContents.zoomFactors).toEqual([1]);
    expect(popoutWindow.webContents.spellCheckerEnabledValues).toEqual([true]);
    for (const listener of popoutWindow.webContents.themeColorListeners) {
      listener(new Event("did-change-theme-color"), "#29344a");
    }
    expect(popoutWindow.backgroundColor).toBe("#29344a");
    expect(popoutWindow.shown).toBe(false);
    popoutWindow.emitReadyToShow();
    expect(popoutWindow.shown).toBe(true);

    const handler = popoutWindow.webContents.windowOpenHandler;
    if (!handler) throw new Error("Expected window open handler");
    expect(handler({ url: "https://bb.invalid/docs" })).toEqual({
      action: "deny",
    });
    expect(handler({ url: "javascript:alert(1)" })).toEqual({
      action: "deny",
    });
    expect(openedExternalUrls).toEqual(["https://bb.invalid/docs"]);
    expect(createdWindows).toHaveLength(2);
  });

  it("never saves pop-outs or lets them take the main window state", async () => {
    const generatedStateKeys: WindowStateKey[] = ["window-second"];
    const { factory, userDataPath } = await createFactoryHarness({
      createWindowStateKey() {
        return generatedStateKeys.shift() ?? "window-fallback";
      },
    });

    const popout = await factory.createPopoutWindow({
      bounds: popoutBounds,
      url: popoutUrl,
    });
    await factory.createWindow({ initialUrl: appUrl, stateKey: null });
    await factory.persistOpenWindows();
    const savedEntries = await readPersistedWindowStateEntries({
      userDataPath,
    });
    expect(savedEntries.map((entry) => entry.stateKey)).toEqual(["main"]);

    popout.close();
    expect(factory.hasPopoutWindows()).toBe(false);
    await waitForPendingWindowStateWrites();
    await expect(
      readPersistedWindowStateEntries({ userDataPath }),
    ).resolves.toEqual(savedEntries);

    await factory.createWindow({ initialUrl: appUrl, stateKey: null });
    await factory.persistOpenWindows();
    const nextEntries = await readPersistedWindowStateEntries({
      userDataPath,
    });
    expect(nextEntries.map((entry) => entry.stateKey)).toEqual([
      "main",
      "window-second",
    ]);
  });

  it("closes pop-outs when every window loads a new URL", async () => {
    const nextUrl = "http://127.0.0.1:40000";
    const { factory } = await createFactoryHarness();
    const standard = await factory.createWindow({
      initialUrl: appUrl,
      stateKey: null,
    });
    const popout = await factory.createPopoutWindow({
      bounds: popoutBounds,
      url: popoutUrl,
    });
    if (
      !(standard instanceof FakeDesktopWindow) ||
      !(popout instanceof FakeDesktopWindow)
    ) {
      throw new Error("Expected fake windows");
    }

    await factory.loadUrl({ url: nextUrl });
    expect(popout.closeCount).toBe(1);
    expect(popout.loadedUrls).toEqual([popoutUrl]);
    expect(standard.loadedUrls).toEqual([appUrl, nextUrl]);

    await factory.loadUrl({ url: appUrl });
    expect(popout.closeCount).toBe(1);
    expect(standard.loadedUrls).toEqual([appUrl, nextUrl, appUrl]);
  });

  it("does not count pop-outs as open app windows", async () => {
    const { factory } = await createFactoryHarness();
    const popout = await factory.createPopoutWindow({
      bounds: popoutBounds,
      url: popoutUrl,
    });
    if (!(popout instanceof FakeDesktopWindow)) {
      throw new Error("Expected a fake window");
    }

    expect(factory.hasOpenWindows()).toBe(false);
    expect(factory.hasPopoutWindows()).toBe(true);
    expect(factory.focusFirstWindow()).toBe(false);
    expect(popout.focusCount).toBe(0);

    const standard = await factory.createWindow({
      initialUrl: appUrl,
      stateKey: null,
    });
    if (!(standard instanceof FakeDesktopWindow)) {
      throw new Error("Expected a fake window");
    }
    expect(factory.hasOpenWindows()).toBe(true);
    expect(factory.focusFirstWindow()).toBe(true);
    expect(standard.focusCount).toBe(1);
    expect(popout.focusCount).toBe(0);
  });

  it("closes a pop-out whose page fails to load", async () => {
    const loadError = new Error("ERR_CONNECTION_REFUSED (-102)");
    const createdWindows: FakeDesktopWindow[] = [];
    const { factory } = await createFactoryHarness({
      browserWindowCreator: {
        create(options) {
          const browserWindow = new FakeDesktopWindow({ options });
          browserWindow.loadError = loadError;
          createdWindows.push(browserWindow);
          return browserWindow;
        },
      },
    });

    await expect(
      factory.createPopoutWindow({ bounds: popoutBounds, url: popoutUrl }),
    ).rejects.toBe(loadError);
    const popout = createdWindows[0];
    if (!popout) throw new Error("Expected a pop-out window");
    expect(popout.closeCount).toBe(1);

    await factory.loadUrl({ url: appUrl });
    expect(popout.closeCount).toBe(1);
  });
});

describe("macosTrafficLightPosition", () => {
  it.each([
    { zoomFactor: 0.5, y: 5 },
    { zoomFactor: 0.9, y: 15 },
    { zoomFactor: 1, y: 18 },
    { zoomFactor: 1.2, y: 23 },
    { zoomFactor: 3, y: 70 },
  ])(
    "keeps the lights on the zoomed chrome control axis at $zoomFactor",
    ({ zoomFactor, y }) => {
      expect(macosTrafficLightPosition(zoomFactor)).toEqual({ x: 18, y });
    },
  );
});
