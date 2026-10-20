import { describe, expect, it } from "vitest";
import { fencedCodeLines } from "./fenced-code.js";
import {
  compileHighlightRules,
  findHighlightRanges,
} from "./highlight-rules.js";
import { IMPORTED_VSCODE_SETTINGS } from "./vscode-settings.js";

describe("fencedCodeLines", () => {
  it("marks the fence lines and everything between", () => {
    const lines = ["prose", "```sh", "echo hi", "```", "prose"];
    expect([...fencedCodeLines(lines)].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it("finds nothing in prose", () => {
    expect(fencedCodeLines(["# Title", "text"]).size).toBe(0);
  });

  it("supports tilde fences", () => {
    expect([...fencedCodeLines(["~~~", "x", "~~~"])]).toEqual([1, 2, 3]);
  });

  it("lets a longer fence contain a shorter one", () => {
    const lines = ["````", "```", "still code", "````", "prose"];
    const fenced = fencedCodeLines(lines);
    expect(fenced.has(3)).toBe(true);
    expect(fenced.has(5)).toBe(false);
  });

  it("does not close a backtick fence with a tilde one", () => {
    const fenced = fencedCodeLines(["```", "x", "~~~", "y"]);
    expect(fenced.has(4)).toBe(true);
  });

  it("runs an unclosed fence to the end of the document", () => {
    const fenced = fencedCodeLines(["```", "a", "b"]);
    expect(fenced.has(3)).toBe(true);
  });

  it("allows a fence to be indented", () => {
    expect(fencedCodeLines(["  ```", "x", "  ```"]).has(2)).toBe(true);
  });
});

const DOC = { path: "note.md", languageId: "markdown" };

describe("user rules and fenced code", () => {
  it("still highlights a TODO inside a fence, as VS Code does", () => {
    const lines = ["```ts", "// TODO: fix this", "```"];
    const found = findHighlightRanges(
      compileHighlightRules(IMPORTED_VSCODE_SETTINGS, DOC),
      lines,
    );
    expect(found.some((range) => range.lineNumber === 2)).toBe(true);
  });
});
