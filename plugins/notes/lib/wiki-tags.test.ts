import { describe, expect, it } from "vitest";
import { parseWikiTags, resolveWikiTagsPath } from "./wiki-tags.js";

const HOME = "/Users/x";

function tagsFile(docs: unknown[], version: unknown = 1): string {
  return JSON.stringify({ version, docs });
}

describe("parseWikiTags", () => {
  it("reads the format the Wiki writes", () => {
    expect(
      parseWikiTags(
        tagsFile([
          {
            tag: "adding-config-catalog",
            title: "Adding config catalog",
            type: "process",
            aliases: ["cc", "config-catalog"],
          },
        ]),
      ),
    ).toEqual([
      {
        tag: "adding-config-catalog",
        title: "Adding config catalog",
        type: "process",
        aliases: ["cc", "config-catalog"],
      },
    ]);
  });

  it("returns null for content that is not JSON", () => {
    expect(parseWikiTags('{"version": 1, "docs": [')).toBeNull();
  });

  it("returns null for a version it does not understand", () => {
    expect(parseWikiTags(tagsFile([], 2))).toBeNull();
  });

  it("returns null when docs is not a list", () => {
    expect(parseWikiTags('{"version": 1, "docs": {}}')).toBeNull();
    expect(parseWikiTags('{"version": 1}')).toBeNull();
    expect(parseWikiTags("[]")).toBeNull();
  });

  it("skips malformed entries and keeps the rest", () => {
    const tags = parseWikiTags(
      tagsFile([
        { title: "No tag" },
        { tag: "!!!", title: "Nothing left after normalizing" },
        { tag: 7, title: "Not a string" },
        "not an object",
        { tag: "good", title: "Good", type: "topic", aliases: [] },
      ]),
    );
    expect(tags?.map((entry) => entry.tag)).toEqual(["good"]);
  });

  it("fills a missing title, type, and alias list", () => {
    expect(parseWikiTags(tagsFile([{ tag: "bare" }]))).toEqual([
      { tag: "bare", title: "bare", type: "topic", aliases: [] },
    ]);
  });

  it("normalizes tags and aliases the way the Wiki does", () => {
    const tags = parseWikiTags(
      tagsFile([
        {
          tag: "@Unified-Push",
          title: "Unified push",
          type: "project",
          aliases: ["@UP", "up", "unified-push", "Two Words", "Café", 7, "--"],
        },
      ]),
    );
    expect(tags).toEqual([
      {
        tag: "unified-push",
        title: "Unified push",
        type: "project",
        aliases: ["up", "two-words", "cafe"],
      },
    ]);
  });

  it("clips a long tag to 80 characters without a trailing dash", () => {
    const long = `${"a".repeat(79)}-tail`;
    const [entry] = parseWikiTags(tagsFile([{ tag: long }])) ?? [];
    expect(entry?.tag).toBe("a".repeat(79));
  });

  it("keeps the first doc when two share a tag", () => {
    const tags = parseWikiTags(
      tagsFile([
        { tag: "notes", title: "First" },
        { tag: "notes", title: "Second" },
      ]),
    );
    expect(tags?.map((entry) => entry.title)).toEqual(["First"]);
  });
});

describe("resolveWikiTagsPath", () => {
  it("treats an unset or blank setting as off", () => {
    expect(resolveWikiTagsPath(undefined, HOME)).toBeNull();
    expect(resolveWikiTagsPath("   ", HOME)).toBeNull();
  });

  it("expands a home-relative path", () => {
    expect(resolveWikiTagsPath(" ~/Wiki/.wiki/tags.json ", HOME)).toBe(
      "/Users/x/Wiki/.wiki/tags.json",
    );
  });

  it("normalizes an absolute path", () => {
    expect(resolveWikiTagsPath("/srv/wiki/../wiki/.wiki/tags.json", HOME)).toBe(
      "/srv/wiki/.wiki/tags.json",
    );
  });

  it("refuses a relative path rather than resolving it against the server", () => {
    expect(resolveWikiTagsPath("Wiki/.wiki/tags.json", HOME)).toBeNull();
  });
});
