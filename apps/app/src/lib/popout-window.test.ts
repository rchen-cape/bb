// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POPOUT_WINDOW_SESSION_KEY,
  readPopoutWindowFlag,
  withPopoutWindowQueryParam,
} from "./popout-window";

function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function importFreshPopoutWindow() {
  vi.resetModules();
  return import("./popout-window");
}

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("withPopoutWindowQueryParam", () => {
  it("adds the flag without dropping the route's query or hash", () => {
    expect(
      withPopoutWindowQueryParam("/plugins/notes/notes/a%20b?view=list#top"),
    ).toBe("/plugins/notes/notes/a%20b?view=list&bbWindow=popout#top");
  });

  it("round-trips through the pop-out boot back to the original route", () => {
    window.history.replaceState(
      null,
      "",
      withPopoutWindowQueryParam("/plugins/notes/notes/daily?view=list#top"),
    );

    expect(readPopoutWindowFlag()).toBe(true);
    expect(currentLocation()).toBe("/plugins/notes/notes/daily?view=list#top");
  });
});

describe("readPopoutWindowFlag", () => {
  it("moves the URL flag into session storage and strips it from the URL", () => {
    const state = { usr: null, key: "boot", idx: 0 };
    window.history.replaceState(
      state,
      "",
      "/plugins/notes/notes?bbWindow=popout#section",
    );

    expect(readPopoutWindowFlag()).toBe(true);
    expect(window.sessionStorage.getItem(POPOUT_WINDOW_SESSION_KEY)).toBe(
      "true",
    );
    expect(currentLocation()).toBe("/plugins/notes/notes#section");
    expect(window.history.state).toEqual(state);
  });

  it("stays a pop-out after a reload has already consumed the URL flag", () => {
    window.sessionStorage.setItem(POPOUT_WINDOW_SESSION_KEY, "true");
    window.history.replaceState(null, "", "/plugins/notes/notes");

    expect(readPopoutWindowFlag()).toBe(true);
    expect(currentLocation()).toBe("/plugins/notes/notes");
  });

  it("treats a window without the flag as a normal window", () => {
    window.history.replaceState(null, "", "/plugins/notes/notes?bbWindow=main");

    expect(readPopoutWindowFlag()).toBe(false);
    expect(window.sessionStorage.getItem(POPOUT_WINDOW_SESSION_KEY)).toBeNull();
    expect(currentLocation()).toBe("/plugins/notes/notes?bbWindow=main");
  });

  it("keeps the URL flag when session storage rejects it so a reload still opens a pop-out", () => {
    window.history.replaceState(
      null,
      "",
      "/plugins/notes/notes?bbWindow=popout",
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    expect(readPopoutWindowFlag()).toBe(true);
    expect(currentLocation()).toBe("/plugins/notes/notes?bbWindow=popout");
  });
});

describe("isPopoutWindow", () => {
  it("remembers the boot decision after the URL flag is gone", async () => {
    window.history.replaceState(
      null,
      "",
      "/plugins/notes/notes?bbWindow=popout",
    );
    const { isPopoutWindow } = await importFreshPopoutWindow();

    expect(isPopoutWindow()).toBe(true);
    window.sessionStorage.clear();
    expect(isPopoutWindow()).toBe(true);
  });

  it("does not turn a normal window into a pop-out mid-session", async () => {
    const { isPopoutWindow } = await importFreshPopoutWindow();

    expect(isPopoutWindow()).toBe(false);
    window.sessionStorage.setItem(POPOUT_WINDOW_SESSION_KEY, "true");
    expect(isPopoutWindow()).toBe(false);
  });
});
