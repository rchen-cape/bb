import { describe, expect, it } from "vitest";
import { toMarkdownMonacoTheme } from "./markdown-theme.js";

type Theme = Parameters<typeof toMarkdownMonacoTheme>[0];

const theme = {
  type: "dark",
  fg: "#e6edf3",
  bg: "#0d1117",
  colors: {},
  tokenColors: [{ settings: { foreground: "#ffffff" } }],
} as unknown as Theme;

describe("toMarkdownMonacoTheme", () => {
  it("lets the foreground override beat a theme's scope-less rule", () => {
    const rules = toMarkdownMonacoTheme(theme, { foreground: "#bbbbbb" }).rules;
    const defaults = rules.filter((rule) => rule.token === "");
    expect(defaults.at(-1)?.foreground).toBe("bbbbbb");
  });

  it("keeps the theme's default text colour without an override", () => {
    const rules = toMarkdownMonacoTheme(theme).rules;
    const defaults = rules.filter((rule) => rule.token === "");
    expect(defaults.at(-1)?.foreground).toBe("ffffff");
  });
});
