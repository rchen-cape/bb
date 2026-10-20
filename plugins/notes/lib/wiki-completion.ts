import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { isInsideCode } from "./live-preview/index.js";
import type { WikiTag, WikiTagsResult } from "./wiki-tags.js";

const REFRESH_INTERVAL_MS = 2_000;

const AT_PREFIX = /(?:^|\s)@([A-Za-z0-9-]*)$/;

const MATCH_RANK = { exact: 0, prefix: 1, other: 2 } as const;

export interface WikiTagsSource {
  call(
    method: "wikiTags",
    input: { knownMtimeMs: number | null },
  ): Promise<WikiTagsResult>;
}

export interface AtPrefix {
  prefix: string;
  startColumn: number;
}

export interface WikiTagMatch {
  tag: WikiTag;
  rank: number;
}

interface TagSnapshot {
  mtimeMs: number | null;
  tags: readonly WikiTag[];
}

const EMPTY_SNAPSHOT: TagSnapshot = { mtimeMs: null, tags: [] };

function nextSnapshot(
  current: TagSnapshot,
  result: WikiTagsResult,
): TagSnapshot {
  switch (result.status) {
    case "unchanged":
      return current;
    case "ok":
      return { mtimeMs: result.mtimeMs, tags: result.tags };
    default:
      return EMPTY_SNAPSHOT;
  }
}

export class WikiTagCache {
  private snapshot: TagSnapshot = EMPTY_SNAPSHOT;
  private lastRefreshAtMs = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get tags(): readonly WikiTag[] {
    return this.snapshot.tags;
  }

  refresh(source: WikiTagsSource): Promise<void> {
    if (this.inflight !== null) return this.inflight;
    const now = this.now();
    if (now - this.lastRefreshAtMs < REFRESH_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.lastRefreshAtMs = now;
    const request = source
      .call("wikiTags", { knownMtimeMs: this.snapshot.mtimeMs })
      .then((result) => {
        this.snapshot = nextSnapshot(this.snapshot, result);
      })
      .catch(() => undefined)
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = request;
    return request;
  }
}

export function findAtPrefix(
  lineText: string,
  column: number,
): AtPrefix | null {
  const match = AT_PREFIX.exec(lineText.slice(0, column - 1));
  if (match === null) return null;
  const prefix = match[1] ?? "";
  return { prefix, startColumn: column - prefix.length };
}

function titleKey(title: string): string {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .join("-");
}

function startsAtWord(name: string, needle: string): boolean {
  return name.startsWith(needle) || name.includes(`-${needle}`);
}

function matchRank(tag: WikiTag, needle: string): number | null {
  const names = [tag.tag, ...tag.aliases];
  if (names.some((name) => name === needle)) return MATCH_RANK.exact;
  if (names.some((name) => name.startsWith(needle))) return MATCH_RANK.prefix;
  const inner = [...names, titleKey(tag.title)].some((name) =>
    startsAtWord(name, needle),
  );
  return inner ? MATCH_RANK.other : null;
}

function compareMatches(left: WikiTagMatch, right: WikiTagMatch): number {
  return left.rank - right.rank || left.tag.tag.localeCompare(right.tag.tag);
}

export function matchTags(
  tags: readonly WikiTag[],
  prefix: string,
): WikiTagMatch[] {
  const needle = prefix.toLowerCase();
  return tags
    .flatMap((tag) => {
      const rank = matchRank(tag, needle);
      return rank === null ? [] : [{ tag, rank }];
    })
    .sort(compareMatches);
}

export function toCompletion({ tag }: WikiTagMatch): Completion {
  return {
    label: tag.tag,
    detail: tag.type === "" ? tag.title : `${tag.title} · ${tag.type}`,
    apply: tag.tag,
  };
}

const pageCache = new WikiTagCache();

export function refreshWikiTags(source: WikiTagsSource): Promise<void> {
  return pageCache.refresh(source);
}

export function wikiCompletionsAt(
  tags: readonly WikiTag[],
  state: EditorState,
  pos: number,
): CompletionResult | null {
  if (tags.length === 0) return null;
  const line = state.doc.lineAt(pos);
  const found = findAtPrefix(line.text, pos - line.from + 1);
  if (found === null || isInsideCode(state, pos)) return null;
  const matches = matchTags(tags, found.prefix);
  if (matches.length === 0) return null;
  return {
    from: pos - found.prefix.length,
    to: pos,
    options: matches.map(toCompletion),
    filter: false,
  };
}

function hasAtPrefix(context: CompletionContext): boolean {
  const line = context.state.doc.lineAt(context.pos);
  return findAtPrefix(line.text, context.pos - line.from + 1) !== null;
}

export function wikiTagSource(
  source: WikiTagsSource,
  cache: WikiTagCache = pageCache,
): CompletionSource {
  return async (context) => {
    if (!hasAtPrefix(context)) return null;
    const refresh = cache.refresh(source);
    if (cache.tags.length === 0) await refresh;
    if (context.aborted) return null;
    return wikiCompletionsAt(cache.tags, context.state, context.pos);
  };
}
