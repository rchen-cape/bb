import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import type { TokenTotals } from "../../src/contract.js";

export type ChartMode = "light" | "dark";

export const TOKEN_TYPES = [
  "inputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "outputTokens",
] as const satisfies readonly (keyof TokenTotals)[];
export type TokenType = (typeof TOKEN_TYPES)[number];

export const TOKEN_TYPE_LABELS: Record<TokenType, string> = {
  inputTokens: "Input",
  cacheReadTokens: "Cache read",
  cacheWriteTokens: "Cache write",
  outputTokens: "Output",
};

export interface ChartPalette {
  mode: ChartMode;
  categorical: readonly string[];
  sequential: readonly string[];
  tokens: Record<TokenType, string>;
  neutral: string;
  accent: string;
  meterTrack: string;
}

const CATEGORICAL: Record<ChartMode, readonly string[]> = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#6250d6",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
};

const SEQUENTIAL: Record<ChartMode, readonly string[]> = {
  light: [
    "#cde2fb",
    "#9ec5f4",
    "#6da7ec",
    "#3987e5",
    "#256abf",
    "#184f95",
    "#0d366b",
  ],
  dark: [
    "#104281",
    "#184f95",
    "#1c5cab",
    "#256abf",
    "#2a78d6",
    "#5598e7",
    "#86b6ef",
  ],
};

function buildPalette(mode: ChartMode): ChartPalette {
  const categorical = CATEGORICAL[mode];
  const slot = (index: number) => categorical[index] ?? categorical[0] ?? "";
  return {
    mode,
    categorical,
    sequential: SEQUENTIAL[mode],
    tokens: {
      inputTokens: slot(0),
      cacheReadTokens: slot(1),
      cacheWriteTokens: slot(2),
      outputTokens: slot(3),
    },
    neutral: "#898781",
    accent: slot(0),
    meterTrack: mode === "light" ? "#cde2fb" : "#104281",
  };
}

const PALETTES: Record<ChartMode, ChartPalette> = {
  light: buildPalette("light"),
  dark: buildPalette("dark"),
};

export function chartPalette(mode: ChartMode): ChartPalette {
  return PALETTES[mode];
}

export function useChartPalette(): ChartPalette {
  return chartPalette(experimental_useCodeTheme().mode);
}

export function categoricalColor(
  palette: ChartPalette,
  slot: number | undefined,
): string {
  if (slot === undefined) return palette.neutral;
  return palette.categorical[slot] ?? palette.neutral;
}

export function sequentialColor(
  palette: ChartPalette,
  value: number,
  max: number,
): string | null {
  if (!(value > 0) || !(max > 0)) return null;
  const steps = palette.sequential.length;
  const index = Math.min(
    steps - 1,
    Math.max(0, Math.ceil((value / max) * steps) - 1),
  );
  return palette.sequential[index] ?? null;
}
