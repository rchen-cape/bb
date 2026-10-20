import { describe, expect, it } from "vitest";
import { resolveNoteLink } from "./note-links.js";

describe("resolveNoteLink", () => {
  it("treats a bare fragment as a heading anchor", () => {
    expect(resolveNoteLink("work/plan.md", "#next-steps")).toEqual({
      kind: "anchor",
      anchor: "next-steps",
    });
  });

  it("passes links with a scheme through to the host", () => {
    for (const href of ["https://bb.dev", "mailto:me@x.com", "//cdn.test/x"]) {
      expect(resolveNoteLink("work/plan.md", href)).toEqual({
        kind: "url",
        href,
      });
    }
  });

  it("resolves relative Markdown links against the note's folder", () => {
    const resolve = (href: string) => resolveNoteLink("work/plan.md", href);
    expect(resolve("other.md")).toEqual({
      kind: "note",
      path: "work/other.md",
    });
    expect(resolve("./sub/a.markdown#part")).toEqual({
      kind: "note",
      path: "work/sub/a.markdown",
    });
    expect(resolve("../top.md?x=1")).toEqual({ kind: "note", path: "top.md" });
    expect(resolve("meeting%20notes.md")).toEqual({
      kind: "note",
      path: "work/meeting notes.md",
    });
    expect(resolveNoteLink("root.md", "a.md")).toEqual({
      kind: "note",
      path: "a.md",
    });
  });

  it("refuses links that leave the notes folder or are not notes", () => {
    const resolve = (href: string) => resolveNoteLink("work/plan.md", href);
    expect(resolve("../../outside.md")).toEqual({ kind: "none" });
    expect(resolve("/etc/notes.md")).toEqual({ kind: "none" });
    expect(resolve("diagram.png")).toEqual({ kind: "none" });
    expect(resolve("")).toEqual({ kind: "none" });
  });
});
