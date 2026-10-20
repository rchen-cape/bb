import { CompletionContext } from "@codemirror/autocomplete";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownState } from "./live-preview/test-support.js";
import {
  findAtPrefix,
  matchTags,
  refreshWikiTags,
  toCompletion,
  WikiTagCache,
  wikiCompletionsAt,
  wikiTagSource,
  type WikiTagsSource,
} from "./wiki-completion.js";
import type { WikiTag, WikiTagsResult } from "./wiki-tags.js";

const CATALOG: WikiTag = {
  tag: "adding-config-catalog",
  title: "Adding config catalog",
  type: "process",
  aliases: ["cc", "config-catalog"],
};

const PUSH: WikiTag = {
  tag: "unified-push",
  title: "Unified push",
  type: "project",
  aliases: [],
};

const CC_TOOLS: WikiTag = {
  tag: "cc-tools",
  title: "CC tools",
  type: "topic",
  aliases: [],
};

function sourceReturning(...results: WikiTagsResult[]) {
  const call = vi.fn<WikiTagsSource["call"]>();
  for (const result of results) call.mockResolvedValueOnce(result);
  const source: WikiTagsSource = { call };
  return { source, call };
}

function clock(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("findAtPrefix", () => {
  it("finds an @ at the start of the line", () => {
    expect(findAtPrefix("@", 2)).toEqual({ prefix: "", startColumn: 2 });
  });

  it("finds an @ after a space or a tab", () => {
    expect(findAtPrefix("- see @con", 11)).toEqual({
      prefix: "con",
      startColumn: 8,
    });
    expect(findAtPrefix("\t@a", 4)).toEqual({ prefix: "a", startColumn: 3 });
  });

  it("ignores an @ inside an email address", () => {
    expect(findAtPrefix("mail rachel@cape", 17)).toBeNull();
    expect(findAtPrefix("rachel@", 8)).toBeNull();
  });

  it("ignores a second @ glued to the first", () => {
    expect(findAtPrefix("@@", 3)).toBeNull();
  });

  it("stops once the cursor has left the tag", () => {
    expect(findAtPrefix("@cc then more", 14)).toBeNull();
    expect(findAtPrefix("@cc.", 5)).toBeNull();
  });

  it("only reads the text before the cursor", () => {
    expect(findAtPrefix("@uni rest", 5)).toEqual({
      prefix: "uni",
      startColumn: 2,
    });
  });
});

describe("matchTags", () => {
  it("offers every doc after a bare @", () => {
    expect(
      matchTags([CATALOG, PUSH], "").map((match) => match.tag.tag),
    ).toEqual(["adding-config-catalog", "unified-push"]);
  });

  it("shows the tag with the title and type beside it", () => {
    const [match] = matchTags([CATALOG], "");
    if (match === undefined) throw new Error("expected a match");
    expect(toCompletion(match)).toEqual({
      label: "adding-config-catalog",
      detail: "Adding config catalog · process",
      apply: "adding-config-catalog",
    });
    expect(
      toCompletion({ tag: { ...CATALOG, type: "" }, rank: 0 }).detail,
    ).toBe("Adding config catalog");
  });

  it("lets an alias find the doc but inserts the canonical tag", () => {
    const [match] = matchTags([CATALOG], "cc");
    expect(match?.tag.tag).toBe("adding-config-catalog");
    expect(match?.rank).toBe(0);
  });

  it("finds a doc with a long title by its short alias", () => {
    const long: WikiTag = {
      tag: "quarterly-planning-for-the-unified-notification-platform-rollout",
      title: "Quarterly planning for the unified notification platform rollout",
      type: "project",
      aliases: ["q3"],
    };
    for (const prefix of ["", "qu", "q3"]) {
      expect(matchTags([long], prefix).map((match) => match.tag.tag)).toEqual([
        long.tag,
      ]);
    }
  });

  it("drops docs the typed text only matches as scattered letters", () => {
    const onboarding: WikiTag = {
      tag: "general-engineering-onboarding",
      title: "General engineering onboarding",
      type: "process",
      aliases: [],
    };
    expect(matchTags([onboarding], "george")).toEqual([]);
    expect(matchTags([CATALOG, PUSH], "atalog")).toEqual([]);
    expect(
      matchTags([onboarding], "gen").map((match) => match.tag.tag),
    ).toEqual(["general-engineering-onboarding"]);
  });

  it("matches the start of any word in the tag, an alias, or the title", () => {
    const titled: WikiTag = {
      tag: "billing",
      title: "Café payments (beta)",
      type: "topic",
      aliases: ["pay-flow"],
    };
    const tags = [CATALOG, PUSH, titled];
    const find = (prefix: string) =>
      matchTags(tags, prefix).map((match) => match.tag.tag);
    expect(find("catalog")).toEqual(["adding-config-catalog"]);
    expect(find("config-cat")).toEqual(["adding-config-catalog"]);
    expect(find("push")).toEqual(["unified-push"]);
    expect(find("flow")).toEqual(["billing"]);
    expect(find("beta")).toEqual(["billing"]);
    expect(find("caf")).toEqual(["billing"]);
  });

  it("ranks an exact match before a prefix match before the rest", () => {
    const titled: WikiTag = {
      tag: "billing-flow",
      title: "CC billing flow",
      type: "process",
      aliases: [],
    };
    const matches = matchTags([PUSH, titled, CC_TOOLS, CATALOG], "CC");
    expect(matches.map((match) => match.rank)).toEqual([0, 1, 2]);
    expect(matches.map((match) => match.tag.tag)).toEqual([
      "adding-config-catalog",
      "cc-tools",
      "billing-flow",
    ]);
  });
});

describe("WikiTagCache", () => {
  const ok: WikiTagsResult = { status: "ok", mtimeMs: 100, tags: [CATALOG] };

  it("loads tags, then sends the known mtime so the server can skip the read", async () => {
    const time = clock();
    const cache = new WikiTagCache(time.now);
    const { source, call } = sourceReturning(ok, { status: "unchanged" });

    await cache.refresh(source);
    time.advance(2_000);
    await cache.refresh(source);

    expect(call).toHaveBeenNthCalledWith(1, "wikiTags", { knownMtimeMs: null });
    expect(call).toHaveBeenNthCalledWith(2, "wikiTags", { knownMtimeMs: 100 });
    expect(cache.tags).toEqual([CATALOG]);
  });

  it("asks the server at most once every two seconds", async () => {
    const time = clock();
    const cache = new WikiTagCache(time.now);
    const { source, call } = sourceReturning(ok, ok);

    await cache.refresh(source);
    time.advance(1_999);
    await cache.refresh(source);

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("shares a request that is still in flight", async () => {
    const cache = new WikiTagCache(clock().now);
    const { source, call } = sourceReturning(ok);

    await Promise.all([cache.refresh(source), cache.refresh(source)]);

    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each(["off", "missing", "invalid"] as const)(
    "clears the list when the server reports %s",
    async (status) => {
      const time = clock();
      const cache = new WikiTagCache(time.now);
      const { source, call } = sourceReturning(ok, { status }, ok);

      await cache.refresh(source);
      time.advance(2_000);
      await cache.refresh(source);
      expect(cache.tags).toEqual([]);

      time.advance(2_000);
      await cache.refresh(source);
      expect(call).toHaveBeenLastCalledWith("wikiTags", { knownMtimeMs: null });
    },
  );

  it("keeps the last list when the request fails", async () => {
    const time = clock();
    const cache = new WikiTagCache(time.now);
    const { source, call } = sourceReturning(ok);
    call.mockRejectedValueOnce(new Error("plugin restarting"));

    await cache.refresh(source);
    time.advance(2_000);
    await expect(cache.refresh(source)).resolves.toBeUndefined();

    expect(cache.tags).toEqual([CATALOG]);
  });
});

describe("wikiCompletionsAt", () => {
  function at(doc: string, pos = doc.length) {
    return wikiCompletionsAt([CATALOG, PUSH], markdownState(doc), pos);
  }

  it("completes from right after the @ with the canonical tag", () => {
    const result = at("- see @cc");
    expect(result?.from).toBe(7);
    expect(result?.to).toBe(9);
    expect(result?.filter).toBe(false);
    expect(result?.options.map((option) => option.label)).toEqual([
      "adding-config-catalog",
    ]);
    expect(result?.options[0]?.apply).toBe("adding-config-catalog");
    expect(result?.options[0]?.detail).toBe("Adding config catalog · process");
  });

  it("orders options by rank, not by the order the tags arrived in", () => {
    const titled: WikiTag = {
      tag: "billing-flow",
      title: "CC billing flow",
      type: "process",
      aliases: [],
    };
    const result = wikiCompletionsAt(
      [PUSH, titled, CC_TOOLS, CATALOG],
      markdownState("@cc"),
      3,
    );
    expect(result?.options.map((option) => option.label)).toEqual([
      "adding-config-catalog",
      "cc-tools",
      "billing-flow",
    ]);
  });

  it("offers every doc after a bare @ and keeps the text after the cursor", () => {
    const result = at("@ rest", 1);
    expect(result?.from).toBe(1);
    expect(result?.to).toBe(1);
    expect(result?.options.map((option) => option.label)).toEqual([
      "adding-config-catalog",
      "unified-push",
    ]);
  });

  it("skips emails, scattered-letter matches, code and an empty tag list", () => {
    expect(at("rachel@cape")).toBeNull();
    expect(at("ask @george")).toBeNull();
    expect(at("```\n@cc\n```", 7)).toBeNull();
    expect(at("`@cc`", 4)).toBeNull();
    expect(wikiCompletionsAt([], markdownState("@cc"), 3)).toBeNull();
  });
});

describe("wikiTagSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function context(doc: string, pos = doc.length) {
    return new CompletionContext(markdownState(doc), pos, false);
  }

  it("waits for the first tag list, then refreshes at most every two seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const cache = new WikiTagCache();
    const { source, call } = sourceReturning(
      { status: "ok", mtimeMs: 1, tags: [CATALOG, PUSH] },
      { status: "unchanged" },
    );
    const complete = wikiTagSource(source, cache);

    const first = await complete(context("- @cc"));
    expect(first?.options.map((option) => option.label)).toEqual([
      "adding-config-catalog",
    ]);
    expect(first?.from).toBe(3);
    expect(call).toHaveBeenCalledTimes(1);

    await complete(context("@"));
    expect(call).toHaveBeenCalledTimes(1);

    vi.setSystemTime(12_000);
    const bare = await complete(context("@"));
    expect(bare?.options).toHaveLength(2);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith("wikiTags", { knownMtimeMs: 1 });
  });

  it("does not ask the server when there is no @ before the cursor", async () => {
    const { source, call } = sourceReturning();
    const complete = wikiTagSource(source, new WikiTagCache());
    expect(await complete(context("plain text"))).toBeNull();
    expect(await complete(context("rachel@cape"))).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("shares the page cache through refreshWikiTags", async () => {
    const { source, call } = sourceReturning({
      status: "ok",
      mtimeMs: 5,
      tags: [PUSH],
    });
    await refreshWikiTags(source);
    const result = await wikiTagSource(source)(context("@uni"));
    expect(result?.options.map((option) => option.label)).toEqual([
      "unified-push",
    ]);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
