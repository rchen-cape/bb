import { describe, expect, it } from "vitest";
import {
  classifyInlineCode,
  createTextMatcher,
  parseKeywords,
} from "./lib/rules.js";

function kinds(text: string, keywords: readonly string[] = []) {
  return createTextMatcher(keywords)
    .find(text)
    .map((match) => [match.kind, text.slice(match.start, match.end)]);
}

describe("createTextMatcher", () => {
  it("finds each kind of key text", () => {
    expect(
      kinds(
        "Todo: rerun it. Note: the build failed with 3 errors in 1.5s, see #42 and BB-123 in src/lib/app.ts:12.",
      ),
    ).toEqual([
      ["todo", "Todo:"],
      ["note", "Note:"],
      ["error", "failed"],
      ["error", "errors"],
      ["number", "1.5s"],
      ["ref", "#42"],
      ["ref", "BB-123"],
      ["path", "src/lib/app.ts:12"],
    ]);
  });

  it("matches Todo case-insensitively but only with a colon", () => {
    expect(kinds("TODO: a, to-do: b, a todo list")).toEqual([
      ["todo", "TODO:"],
      ["todo", "to-do:"],
    ]);
  });

  it("ignores lowercase dash-number words and slash words without a file", () => {
    expect(kinds("utf-8 and/or client/server")).toEqual([]);
  });

  it("treats keyword characters literally and prefers the longest keyword", () => {
    expect(kinds("check a.b and a.b.c then axb", ["a.b", "a.b.c"])).toEqual([
      ["keyword", "a.b"],
      ["keyword", "a.b.c"],
    ]);
  });
});

describe("parseKeywords", () => {
  it("trims, dedupes case-insensitively, and drops blanks", () => {
    expect(parseKeywords(" Rollback, rollback,,\nmigration ")).toEqual([
      "Rollback",
      "migration",
    ]);
  });
});

describe("classifyInlineCode", () => {
  it.each([
    ["src/app.ts", "code-path"],
    ["package.json", "code-path"],
    ["./scripts/run.sh:4", "code-path"],
    ["pnpm install", "code-command"],
    ["$ ls -la", "code-command"],
    ["useState", null],
    ["1.5", null],
    ["foo(bar)", null],
    ["git", null],
  ])("%s → %s", (text, expected) => {
    expect(classifyInlineCode(text)).toBe(expected);
  });
});
