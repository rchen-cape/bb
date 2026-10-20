import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_MAX_POPOUT_WINDOW_PATH_LENGTH,
  bbDesktopInfoSchema,
  bbDesktopPopoutWindowRequestSchema,
} from "../src/info.js";

const baseInfo = {
  lastCheckedAt: null,
  latestVersion: "0.0.32",
  pendingVersion: null,
  platform: "macos",
  updateAvailable: true,
  updateDownloaded: false,
  version: "0.0.31",
} as const;

describe("bbDesktopInfoSchema", () => {
  it("accepts both explicit download state and legacy shell payloads", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "downloading",
      }).success,
    ).toBe(true);
    expect(bbDesktopInfoSchema.safeParse(baseInfo).success).toBe(true);
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        lastCheckedAt: "2026-05-21T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown download state", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "available",
      }).success,
    ).toBe(false);
  });

  it("accepts linux", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "linux",
      }).success,
    ).toBe(true);
  });

  it("rejects win32", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "win32",
      }).success,
    ).toBe(false);
  });
});

describe("bbDesktopPopoutWindowRequestSchema", () => {
  it.each([
    "/plugins/notes/notes?bbWindow=popout",
    `/${"a".repeat(BB_DESKTOP_MAX_POPOUT_WINDOW_PATH_LENGTH - 1)}`,
  ])("accepts the absolute path %#", (path) => {
    expect(bbDesktopPopoutWindowRequestSchema.parse({ path })).toEqual({
      path,
    });
  });

  it.each([
    { name: "a missing path", request: {} },
    { name: "an empty path", request: { path: "" } },
    { name: "a relative path", request: { path: "plugins/notes/notes" } },
    {
      name: "an absolute URL",
      request: { path: "https://bb.invalid/plugins/notes/notes" },
    },
    { name: "a non-string path", request: { path: 1 } },
    {
      name: "a path over the length limit",
      request: {
        path: `/${"a".repeat(BB_DESKTOP_MAX_POPOUT_WINDOW_PATH_LENGTH)}`,
      },
    },
    {
      name: "unknown fields",
      request: { path: "/plugins/notes/notes", url: "https://bb.invalid/" },
    },
  ])("rejects $name", ({ request }) => {
    expect(bbDesktopPopoutWindowRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });
});
