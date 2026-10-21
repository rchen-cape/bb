import { describe, expect, it, vi } from "vitest";
import {
  createConfigStore,
  defaultConfig,
  readConfig,
  resolveTodoColor,
} from "./lib/config.js";
import { buildStylesheet } from "./lib/styles.js";

describe("resolveTodoColor", () => {
  it("uses the code theme's link color, as Notes does", () => {
    expect(
      resolveTodoColor({
        mode: "dark",
        theme: { colors: { "textLink.activeForeground": "#4daafc" } },
      }),
    ).toBe("#4daafc");
  });

  it("falls back per mode when the theme has no safe color", () => {
    expect(resolveTodoColor({ mode: "light", theme: null })).toBe("#006ab1");
    expect(
      resolveTodoColor({
        mode: "dark",
        theme: {
          colors: {
            "textLink.activeForeground": "red; } body { display: none",
          },
        },
      }),
    ).toBe("#3794ff");
  });
});

describe("readConfig", () => {
  it("applies defaults for missing or mistyped values", () => {
    expect(
      readConfig(
        { styling: "yes", intensity: "loud" },
        { mode: "light", theme: null },
      ),
    ).toEqual(defaultConfig("light"));
  });

  it("reads every setting", () => {
    expect(
      readConfig(
        {
          styling: false,
          intensity: "bold",
          keywordHighlights: false,
          dimNarration: false,
          clickToCopy: false,
          customKeywords: "a, b",
        },
        { mode: "dark", theme: null },
      ),
    ).toEqual({
      styling: false,
      intensity: "bold",
      keywordHighlights: false,
      dimNarration: false,
      clickToCopy: false,
      customKeywords: ["a", "b"],
      todoColor: "#3794ff",
    });
  });
});

describe("createConfigStore", () => {
  it("notifies only on real changes", () => {
    const store = createConfigStore(defaultConfig("light"));
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ ...defaultConfig("light"), customKeywords: [] });
    expect(listener).not.toHaveBeenCalled();
    store.set({ ...defaultConfig("light"), intensity: "bold" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("buildStylesheet", () => {
  it("drops the layers that are turned off", () => {
    const css = buildStylesheet({
      ...defaultConfig("light"),
      styling: false,
      keywordHighlights: false,
      dimNarration: false,
      clickToCopy: false,
    });
    expect(css.trim()).toBe(":root { --readable-threads-todo: #006ab1; }");
  });

  it("never uses @scope", () => {
    expect(buildStylesheet(defaultConfig("dark"))).not.toContain("@scope");
  });
});
