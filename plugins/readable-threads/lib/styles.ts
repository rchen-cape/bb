import type { ReadableThreadsConfig } from "./config.js";
import { COPY_TIP_ATTRIBUTE } from "./copy-tip.js";
import { HIGHLIGHT_KINDS, type HighlightKind } from "./rules.js";

export const HIGHLIGHT_NAME_PREFIX = "readable-threads-";
export const COPIED_HIGHLIGHT_NAME = `${HIGHLIGHT_NAME_PREFIX}copied`;

export function highlightName(kind: HighlightKind): string {
  return `${HIGHLIGHT_NAME_PREFIX}${kind}`;
}

const MESSAGE = ":where([data-message-column])";
const USER_ROW =
  '[data-timeline-row-id*=":user-seed:"], [data-timeline-row-id*=":provider-input:"]';
const NARRATION_ROW = `:where([data-timeline-row-id*=":assistant:"]:is(:has(+ [data-timeline-row-id]:not(${USER_ROW})), :has(+ :not([data-timeline-row-id]) + [data-timeline-row-id]:not(${USER_ROW}))))`;
const REASONING_TEXT =
  ':where([data-timeline-row-id*=":op:reasoning:"]) :where(.whitespace-pre-wrap)';
const INLINE_CODE = `${MESSAGE} :where(:not(pre) > code)`;
const COPYABLE_CODE = `${INLINE_CODE}:where(:not(a *, button *, [contenteditable] *))`;
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
${INLINE_CODE} {
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

function dimRules(bold: boolean): string {
  return `
${NARRATION_ROW} :where([data-message-column]) {
  opacity: ${bold ? 0.5 : 0.62};
  transition: opacity 150ms ease-out;
}
${NARRATION_ROW} :where([data-message-column]:hover, [data-message-column]:focus-within) {
  opacity: 1;
}
${REASONING_TEXT} {
  opacity: ${bold ? 0.6 : 0.72};
}
`;
}

function clickToCopyRules(): string {
  return `
${COPYABLE_CODE} {
  cursor: pointer;
  transition:
    background-color 120ms ease-out,
    box-shadow 120ms ease-out;
}
${COPYABLE_CODE}:hover {
  background-color: ${mix("var(--timeline-accent)", 18)};
  box-shadow: inset 0 0 0 1px ${mix("var(--timeline-accent)", 40)};
}
::highlight(${COPIED_HIGHLIGHT_NAME}) {
  color: var(--success-text);
  background-color: ${mix("var(--success)", 28)};
}
[${COPY_TIP_ATTRIBUTE}] {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  transform: translate(-50%, calc(-100% + 2px));
  transition:
    opacity 120ms ease-out,
    transform 120ms ease-out;
}
[${COPY_TIP_ATTRIBUTE}][data-side="bottom"] {
  transform: translate(-50%, -2px);
}
[${COPY_TIP_ATTRIBUTE}][data-visible] {
  opacity: 1;
  transform: translate(-50%, -100%);
}
[${COPY_TIP_ATTRIBUTE}][data-side="bottom"][data-visible] {
  transform: translate(-50%, 0);
}
[${COPY_TIP_ATTRIBUTE}][data-state="copied"]::before {
  content: "✓ ";
}
@media (prefers-reduced-motion: reduce) {
  ${COPYABLE_CODE},
  [${COPY_TIP_ATTRIBUTE}] {
    transition: none;
  }
}
`;
}

export function buildStylesheet(config: ReadableThreadsConfig): string {
  const bold = config.intensity === "bold";
  const root = `:root { --readable-threads-todo: ${config.todoColor}; }`;
  return [
    root,
    config.styling ? stylingRules(bold) : "",
    config.dimNarration ? dimRules(bold) : "",
    config.clickToCopy ? clickToCopyRules() : "",
    config.keywordHighlights ? highlightRules(bold) : "",
  ].join("\n");
}
