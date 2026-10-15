import { describe, expect, it } from "vitest";
import { findDailyNotePath } from "./daily-note.js";
import type { FlatEntry } from "./notes-tree.js";

const file = (path: string): FlatEntry => ({ path, kind: "file" });

describe("findDailyNotePath", () => {
  it("finds an MM-DD-YY note in a nested folder", () => {
    expect(
      findDailyNotePath(
        [file("oct2026/10-13-26.md"), file("oct2026/10-14-26.md")],
        new Date(2026, 9, 14),
      ),
    ).toBe("oct2026/10-14-26.md");
  });

  it("accepts a zero-padded or unpadded single-digit month", () => {
    const date = new Date(2026, 8, 3);
    expect(findDailyNotePath([file("sept2026/9-03-26.md")], date)).toBe(
      "sept2026/9-03-26.md",
    );
    expect(findDailyNotePath([file("sept2026/09-03-26.md")], date)).toBe(
      "sept2026/09-03-26.md",
    );
  });

  it("returns null when there is no note for the date", () => {
    expect(
      findDailyNotePath(
        [file("oct2026/10-13-26.md"), { path: "10-14-26.md", kind: "directory" }],
        new Date(2026, 9, 14),
      ),
    ).toBeNull();
  });
});
