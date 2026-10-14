import { describe, expect, it } from "vitest";
import {
  parseUsageRoute,
  subPathSegments,
  usageThreadSubPath,
} from "./route.js";

describe("subPathSegments", () => {
  it("drops empty segments and decodes the rest", () => {
    expect(subPathSegments("/usage//thread/thr%201/")).toEqual([
      "usage",
      "thread",
      "thr 1",
    ]);
  });

  it("keeps a malformed escape as written", () => {
    expect(subPathSegments("usage/thread/%E0%A4%A")).toEqual([
      "usage",
      "thread",
      "%E0%A4%A",
    ]);
  });
});

describe("parseUsageRoute", () => {
  it("routes the section root to the dashboard", () => {
    expect(parseUsageRoute([])).toEqual({ view: "dashboard" });
  });

  it("routes a thread page", () => {
    expect(parseUsageRoute(["thread", "thr_1"])).toEqual({
      view: "thread",
      threadId: "thr_1",
    });
  });

  it("rejects anything else", () => {
    expect(parseUsageRoute(["thread"])).toEqual({ view: "unknown" });
    expect(parseUsageRoute(["thread", "thr_1", "extra"])).toEqual({
      view: "unknown",
    });
    expect(parseUsageRoute(["models"])).toEqual({ view: "unknown" });
  });

  it("builds the thread page address the parser reads back", () => {
    const [, ...rest] = subPathSegments(usageThreadSubPath("thr_9"));
    expect(parseUsageRoute(rest)).toEqual({
      view: "thread",
      threadId: "thr_9",
    });
  });
});
