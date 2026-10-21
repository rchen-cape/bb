export const HIGHLIGHT_KINDS = [
  "todo",
  "note",
  "keyword",
  "error",
  "warning",
  "ref",
  "path",
  "number",
  "code-path",
  "code-command",
] as const;

export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];

export type TextKind = Exclude<HighlightKind, "code-path" | "code-command">;

export interface TextMatch {
  kind: TextKind;
  start: number;
  end: number;
}

export interface TextMatcher {
  find(text: string): TextMatch[];
}

const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LENGTH = 64;

const PATTERNS: readonly (readonly [TextKind, string])[] = [
  ["todo", String.raw`\bto-?do:`],
  ["note", String.raw`\b(?:note|tip|important|heads up):`],
  ["keyword", ""],
  [
    "error",
    String.raw`\b(?:errors?|failed|failures?|failing|fails|crash(?:ed|es|ing)?|exceptions?|broken|regressions?)\b`,
  ],
  [
    "warning",
    String.raw`\b(?:warnings?|caution|deprecated|breaking changes?)\b`,
  ],
  ["ref", String.raw`(?<![\w&#])#\d+\b|\b[a-z][a-z0-9]+-\d+\b`],
  [
    "path",
    String.raw`(?<![\w/.~-])(?:(?:~|\.{1,2})?\/)?(?:[\w@-][\w@.-]*\/)+[\w@-][\w@.-]*\.[a-z0-9]{1,8}(?::\d+(?::\d+)?)?(?![\w/])`,
  ],
  [
    "number",
    String.raw`\b\d+(?:[.,]\d+)?\s?(?:ms|s|secs?|seconds?|mins?|minutes?|hrs?|hours?|h|days?|kb|mb|gb|tb|%|x|px|tokens?|lines?|files?|tests?)(?![\w%])`,
  ],
];

export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const keyword = part.trim().slice(0, MAX_KEYWORD_LENGTH);
    const key = keyword.toLowerCase();
    if (keyword.length === 0 || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length === MAX_KEYWORDS) break;
  }
  return keywords;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createTextMatcher(keywords: readonly string[]): TextMatcher {
  const keywordPattern =
    keywords.length === 0
      ? null
      : String.raw`(?<!\w)(?:${[...keywords]
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp)
          .join("|")})(?!\w)`;
  const groups: TextKind[] = [];
  const sources: string[] = [];
  for (const [kind, source] of PATTERNS) {
    const pattern = kind === "keyword" ? keywordPattern : source;
    if (pattern === null) continue;
    groups.push(kind);
    sources.push(`(${pattern})`);
  }
  const regex = new RegExp(sources.join("|"), "gi");

  return {
    find(text) {
      const matches: TextMatch[] = [];
      if (text.trim().length === 0) return matches;
      for (const match of text.matchAll(regex)) {
        const value = match[0];
        if (value.length === 0) continue;
        const groupIndex = match.findIndex(
          (group, index) => index > 0 && group !== undefined,
        );
        const kind = groups[groupIndex - 1];
        if (kind === undefined) continue;
        if (
          kind === "ref" &&
          !value.startsWith("#") &&
          value !== value.toUpperCase()
        ) {
          continue;
        }
        const start = match.index;
        matches.push({ kind, start, end: start + value.length });
      }
      return matches;
    },
  };
}

const SHELL_COMMANDS = new Set([
  "awk",
  "bb",
  "brew",
  "bun",
  "cargo",
  "cat",
  "cd",
  "chmod",
  "cp",
  "curl",
  "docker",
  "echo",
  "export",
  "gh",
  "git",
  "go",
  "grep",
  "jq",
  "kubectl",
  "ls",
  "make",
  "mkdir",
  "mv",
  "node",
  "npm",
  "npx",
  "pip",
  "pnpm",
  "python",
  "python3",
  "rg",
  "rm",
  "sed",
  "tsc",
  "turbo",
  "uv",
  "vitest",
  "yarn",
]);

const INLINE_PATH =
  /^(?:~|\.{1,2})?\/?[\w@-][\w@.-]*(?:\/[\w@.-]+)*\/?(?::\d+(?::\d+)?)?$/;
const FILE_EXTENSION = /\.[a-z][a-z0-9]{0,4}(?::\d+(?::\d+)?)?$/i;

export function classifyInlineCode(
  text: string,
): "code-path" | "code-command" | null {
  const value = text.trim();
  if (value.length === 0 || value.length > 300) return null;
  if (
    !/\s/.test(value) &&
    INLINE_PATH.test(value) &&
    (value.includes("/") || FILE_EXTENSION.test(value))
  ) {
    return "code-path";
  }
  const words = value.replace(/^\$\s+/, "").split(/\s+/);
  const first = words[0] ?? "";
  if (
    value.startsWith("$ ") ||
    (words.length > 1 && SHELL_COMMANDS.has(first))
  ) {
    return "code-command";
  }
  return null;
}
