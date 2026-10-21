import { parseKeywords } from "./rules.js";

export type Intensity = "subtle" | "bold";

export interface ReadableThreadsConfig {
  styling: boolean;
  intensity: Intensity;
  keywordHighlights: boolean;
  customKeywords: readonly string[];
  todoColor: string;
}

export interface CodeThemeInput {
  mode: "light" | "dark";
  theme: { colors: Readonly<Record<string, string>> } | null;
}

export const TODO_THEME_COLOR = "textLink.activeForeground";

const FALLBACK_TODO_COLOR: Record<CodeThemeInput["mode"], string> = {
  light: "#006ab1",
  dark: "#3794ff",
};

const SAFE_COLOR =
  /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

export function resolveTodoColor(codeTheme: CodeThemeInput): string {
  const themed = codeTheme.theme?.colors[TODO_THEME_COLOR]?.trim();
  return themed !== undefined && SAFE_COLOR.test(themed)
    ? themed
    : FALLBACK_TODO_COLOR[codeTheme.mode];
}

export function defaultConfig(
  mode: CodeThemeInput["mode"],
): ReadableThreadsConfig {
  return {
    styling: true,
    intensity: "subtle",
    keywordHighlights: true,
    customKeywords: [],
    todoColor: FALLBACK_TODO_COLOR[mode],
  };
}

export function readConfig(
  values: Readonly<Record<string, string | number | boolean>> | undefined,
  codeTheme: CodeThemeInput,
): ReadableThreadsConfig {
  const defaults = defaultConfig(codeTheme.mode);
  const bool = (key: string, fallback: boolean) => {
    const value = values?.[key];
    return typeof value === "boolean" ? value : fallback;
  };
  const intensity = values?.intensity;
  const keywords = values?.customKeywords;
  return {
    styling: bool("styling", defaults.styling),
    intensity: intensity === "bold" ? "bold" : "subtle",
    keywordHighlights: bool("keywordHighlights", defaults.keywordHighlights),
    customKeywords: typeof keywords === "string" ? parseKeywords(keywords) : [],
    todoColor: resolveTodoColor(codeTheme),
  };
}

export function sameConfig(
  a: ReadableThreadsConfig,
  b: ReadableThreadsConfig,
): boolean {
  return (
    a.styling === b.styling &&
    a.intensity === b.intensity &&
    a.keywordHighlights === b.keywordHighlights &&
    a.todoColor === b.todoColor &&
    a.customKeywords.length === b.customKeywords.length &&
    a.customKeywords.every(
      (keyword, index) => keyword === b.customKeywords[index],
    )
  );
}

export interface ConfigStore {
  get(): ReadableThreadsConfig;
  set(next: ReadableThreadsConfig): void;
  subscribe(listener: (config: ReadableThreadsConfig) => void): () => void;
}

export function createConfigStore(initial: ReadableThreadsConfig): ConfigStore {
  let current = initial;
  const listeners = new Set<(config: ReadableThreadsConfig) => void>();
  return {
    get: () => current,
    set(next) {
      if (sameConfig(current, next)) return;
      current = next;
      for (const listener of listeners) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
