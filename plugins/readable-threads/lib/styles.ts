import type { ReadableThreadsConfig } from "./config.js";
import { HIGHLIGHT_KINDS, type HighlightKind } from "./rules.js";

export const HIGHLIGHT_NAME_PREFIX = "readable-threads-";

export function highlightName(kind: HighlightKind): string {
  return `${HIGHLIGHT_NAME_PREFIX}${kind}`;
}

const MESSAGE = ":where([data-message-column])";
const ASSISTANT = ":where([data-message-column]:not(:has(> .ml-auto)))";
const USER_BUBBLE =
  ":where([data-message-column] > .ml-auto > div:last-child > div:first-child)";
const CODE_BLOCK = `${MESSAGE} :where(div:has(> pre.bb-code-highlight))`;
const SHELL_LANGUAGES = [
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "fish",
  "powershell",
];
const DATA_LANGUAGES = [
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "xml",
  "csv",
  "sql",
];

function languageSelector(languages: readonly string[]): string {
  return languages.map((language) => `.language-${language}`).join(", ");
}

function mix(color: string, amount: number, base = "transparent"): string {
  return `color-mix(in oklab, ${color} ${amount}%, ${base})`;
}

function stylingRules(bold: boolean): string {
  const accent = "var(--timeline-accent)";
  const tint = bold ? 16 : 10;
  return `
${MESSAGE} :where(strong, b) {
  font-weight: ${bold ? 700 : 650};
  color: ${bold ? mix(accent, 55, "var(--foreground)") : mix(accent, 30, "var(--foreground)")};
}
${MESSAGE} :where(em, i) {
  color: ${mix("var(--muted-foreground)", bold ? 85 : 70, "var(--foreground)")};
}
${MESSAGE} :where(strong em, em strong, b i, i b) {
  color: ${mix(accent, 55, "var(--foreground)")};
}
${MESSAGE} :where(h1, h2, h3) {
  color: ${mix(accent, bold ? 45 : 25, "var(--foreground)")};
}
${MESSAGE} :where(h1, h2) {
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--border-hairline);
}
${MESSAGE} :where(blockquote) {
  border-left-color: ${accent};
  background: ${mix(accent, tint * 0.6)};
  border-radius: 0 0.375rem 0.375rem 0;
  padding-block: 0.25rem;
}
${MESSAGE} :where(li)::marker {
  color: ${mix(accent, 80, "var(--muted-foreground)")};
}
${MESSAGE} :where(:not(pre) > code) {
  color: ${mix(accent, bold ? 60 : 45, "var(--foreground)")};
  background: ${mix(accent, tint)};
  box-shadow: inset 0 0 0 1px ${mix(accent, tint + 6)};
}
${CODE_BLOCK} {
  --readable-threads-code-accent: ${accent};
  border-left: 3px solid var(--readable-threads-code-accent);
}
${CODE_BLOCK}:where(:has(> pre > code:is(${languageSelector(SHELL_LANGUAGES)}))) {
  --readable-threads-code-accent: var(--success-text);
}
${CODE_BLOCK}:where(:has(> pre > code:is(${languageSelector(DATA_LANGUAGES)}))) {
  --readable-threads-code-accent: ${mix(accent, 50, "var(--muted-foreground)")};
}
${CODE_BLOCK}:where(:has(> pre > code.language-diff)) {
  --readable-threads-code-accent: var(--warning-text);
}
${CODE_BLOCK} > :where(div:first-child) > :where(span:first-child) {
  color: var(--readable-threads-code-accent);
  font-weight: 600;
}
${ASSISTANT} {
  border-left: 2px solid ${mix(accent, bold ? 55 : 35)};
  padding-left: 0.75rem;
}
${USER_BUBBLE} {
  border-color: ${mix(accent, bold ? 45 : 30)};
  background: ${mix(accent, bold ? 14 : 8, "var(--surface-recessed)")};
}
:where([data-testid="thread-unread-divider"]) {
  font-weight: 700;
  color: var(--readable-threads-todo);
}
:where([data-testid="thread-unread-divider"]) > :where(span[aria-hidden]) {
  height: 2px;
  background: var(--readable-threads-todo);
}
`;
}

function highlightColors(
  kind: HighlightKind,
  bold: boolean,
): { color?: string; background?: string } {
  const accent = "var(--timeline-accent)";
  switch (kind) {
    case "todo":
      return { color: "var(--readable-threads-todo)" };
    case "note":
      return { color: accent };
    case "keyword":
      return {
        background: mix("var(--warning)", bold ? 38 : 24),
        color: "var(--foreground)",
      };
    case "error":
      return { color: "var(--destructive-text)" };
    case "warning":
      return { color: "var(--warning-text)" };
    case "ref":
    case "path":
      return { color: mix(accent, bold ? 85 : 65, "var(--foreground)") };
    case "number":
      return { color: mix(accent, bold ? 70 : 45, "var(--foreground)") };
    case "code-path":
      return { color: accent };
    case "code-command":
      return { color: "var(--success-text)" };
  }
}

function highlightRules(bold: boolean): string {
  return HIGHLIGHT_KINDS.map((kind) => {
    const { color, background } = highlightColors(kind, bold);
    const declarations = [
      color === undefined ? null : `color: ${color};`,
      background === undefined ? null : `background-color: ${background};`,
    ].filter((line) => line !== null);
    return `::highlight(${highlightName(kind)}) { ${declarations.join(" ")} }`;
  }).join("\n");
}

export function buildStylesheet(config: ReadableThreadsConfig): string {
  const bold = config.intensity === "bold";
  const root = `:root { --readable-threads-todo: ${config.todoColor}; }`;
  return [
    root,
    config.styling ? stylingRules(bold) : "",
    config.keywordHighlights ? highlightRules(bold) : "",
  ].join("\n");
}
