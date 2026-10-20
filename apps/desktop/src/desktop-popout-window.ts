import { bbDesktopPopoutWindowRequestSchema } from "@bb/desktop-contract";
import { ipcMain, type WebContents } from "electron";
import { BB_DESKTOP_OPEN_POPOUT_WINDOW_CHANNEL } from "./desktop-window-command-ipc.js";
import type { DisplayWorkArea, WindowBounds } from "./types.js";

const POPOUT_WINDOW_WIDTH = 960;
const POPOUT_WINDOW_HEIGHT = 800;
const POPOUT_WINDOW_OFFSET = 32;
const APP_URL_PROTOCOLS = new Set(["http:", "https:"]);
const UNSAFE_POPOUT_PATH_CHARACTERS = /[\\\p{Cc}]/u;

interface ResolvePopoutWindowUrlArgs {
  appUrl: string | null;
  path: string;
  senderUrl: string | null;
}

interface ResolvePopoutWindowBoundsArgs {
  openerBounds: WindowBounds;
  workArea: DisplayWorkArea;
}

interface OpenPopoutWindowArgs {
  opener: WebContents;
  url: string;
}

interface ResolveAppCommandTargetArgs<TWindow> {
  applicationWindows: readonly TWindow[];
  focusedWindow: TWindow | null;
  isPopoutWindow(browserWindow: TWindow): boolean;
}

export type AppCommandTarget<TWindow> =
  | { kind: "none" }
  | { kind: "open-standard-window" }
  | { focus: boolean; kind: "send"; window: TWindow };

interface RegisterDesktopPopoutWindowIpcArgs {
  applicationWindowWebContentsIds: ReadonlySet<number>;
  getAppUrl(): string | null;
  open(args: OpenPopoutWindowArgs): Promise<boolean>;
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolvePopoutWindowUrl({
  appUrl,
  path,
  senderUrl,
}: ResolvePopoutWindowUrlArgs): string | null {
  if (
    appUrl === null ||
    senderUrl === null ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    UNSAFE_POPOUT_PATH_CHARACTERS.test(path)
  ) {
    return null;
  }
  const app = parseUrl(appUrl);
  if (app === null || !APP_URL_PROTOCOLS.has(app.protocol)) {
    return null;
  }
  const resolved = parseUrl(path, app.href);
  const sender = parseUrl(senderUrl);
  if (
    resolved === null ||
    sender === null ||
    resolved.origin !== app.origin ||
    sender.origin !== app.origin
  ) {
    return null;
  }
  return resolved.href;
}

export function resolvePopoutWindowBounds({
  openerBounds,
  workArea,
}: ResolvePopoutWindowBoundsArgs): WindowBounds {
  const width = Math.min(POPOUT_WINDOW_WIDTH, workArea.width);
  const height = Math.min(POPOUT_WINDOW_HEIGHT, workArea.height);
  const x =
    openerBounds.x +
    Math.round((openerBounds.width - width) / 2) +
    POPOUT_WINDOW_OFFSET;
  const y =
    openerBounds.y +
    Math.round((openerBounds.height - height) / 2) +
    POPOUT_WINDOW_OFFSET;
  return {
    height,
    width,
    x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height),
  };
}

export function resolveAppCommandTarget<TWindow>({
  applicationWindows,
  focusedWindow,
  isPopoutWindow,
}: ResolveAppCommandTargetArgs<TWindow>): AppCommandTarget<TWindow> {
  if (focusedWindow === null) {
    return { kind: "none" };
  }
  if (!isPopoutWindow(focusedWindow)) {
    return { focus: false, kind: "send", window: focusedWindow };
  }
  const standardWindow = applicationWindows.find(
    (browserWindow) => !isPopoutWindow(browserWindow),
  );
  return standardWindow === undefined
    ? { kind: "open-standard-window" }
    : { focus: true, kind: "send", window: standardWindow };
}

export function registerDesktopPopoutWindowIpc({
  applicationWindowWebContentsIds,
  getAppUrl,
  open,
}: RegisterDesktopPopoutWindowIpcArgs): void {
  ipcMain.handle(
    BB_DESKTOP_OPEN_POPOUT_WINDOW_CHANNEL,
    async (event, payload: unknown) => {
      if (
        !applicationWindowWebContentsIds.has(event.sender.id) ||
        event.senderFrame === null ||
        event.senderFrame !== event.sender.mainFrame
      ) {
        throw new Error("Pop-out windows are limited to bb windows");
      }
      const parsed = bbDesktopPopoutWindowRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      const url = resolvePopoutWindowUrl({
        appUrl: getAppUrl(),
        path: parsed.data.path,
        senderUrl: event.senderFrame.url,
      });
      if (url === null) {
        return false;
      }
      return await open({ opener: event.sender, url });
    },
  );
}
