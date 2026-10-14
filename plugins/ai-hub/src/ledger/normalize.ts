import { z } from "zod";

export const CODEX_PROVIDER_ID = "codex";

export const tokenBreakdownSchema = z
  .object({
    totalTokens: z.number(),
    inputTokens: z.number(),
    cachedInputTokens: z.number(),
    cacheReadInputTokens: z.number().optional(),
    cacheWriteInputTokens: z.number().optional(),
    outputTokens: z.number(),
    reasoningOutputTokens: z.number(),
  })
  .loose();
export type TokenBreakdown = z.infer<typeof tokenBreakdownSchema>;

export const ledgerTokensSchema = z
  .object({
    input: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    reasoning: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type LedgerTokens = z.infer<typeof ledgerTokensSchema>;

export const streamBaselineSchema = z
  .object({
    providerThreadId: z.string(),
    lastTotal: ledgerTokensSchema,
  })
  .strict();
export type StreamBaseline = z.infer<typeof streamBaselineSchema>;

export type UsageDialect = "codex" | "standard";

export interface UsageIncrement {
  live: LedgerTokens | null;
  backfill: LedgerTokens | null;
  baseline: StreamBaseline;
}

interface TokenDelta {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

const DELTA_FIELDS = [
  "input",
  "cacheRead",
  "cacheWrite",
  "output",
  "reasoning",
] as const;

export const ZERO_TOKENS: LedgerTokens = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total: 0,
};

export function usageDialect(providerId: string): UsageDialect {
  return providerId === CODEX_PROVIDER_ID ? "codex" : "standard";
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function withTotal(delta: TokenDelta): LedgerTokens {
  const input = count(delta.input);
  const cacheRead = count(delta.cacheRead);
  const cacheWrite = count(delta.cacheWrite);
  const output = count(delta.output);
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    reasoning: count(delta.reasoning),
    total: input + cacheRead + cacheWrite + output,
  };
}

export function normalizeBreakdown(
  breakdown: TokenBreakdown,
  dialect: UsageDialect,
): LedgerTokens {
  const cached = breakdown.cachedInputTokens;
  const cacheWrite = breakdown.cacheWriteInputTokens ?? 0;
  return withTotal({
    input:
      dialect === "codex"
        ? breakdown.inputTokens - cached - cacheWrite
        : breakdown.inputTokens,
    cacheRead:
      breakdown.cacheReadInputTokens ??
      (dialect === "codex" ? cached : cached - cacheWrite),
    cacheWrite,
    output: breakdown.outputTokens,
    reasoning: breakdown.reasoningOutputTokens,
  });
}

function subtract(left: TokenDelta, right: TokenDelta): TokenDelta {
  return {
    input: left.input - right.input,
    cacheRead: left.cacheRead - right.cacheRead,
    cacheWrite: left.cacheWrite - right.cacheWrite,
    output: left.output - right.output,
    reasoning: left.reasoning - right.reasoning,
  };
}

function smallest(left: TokenDelta, right: TokenDelta): TokenDelta {
  return {
    input: Math.min(left.input, right.input),
    cacheRead: Math.min(left.cacheRead, right.cacheRead),
    cacheWrite: Math.min(left.cacheWrite, right.cacheWrite),
    output: Math.min(left.output, right.output),
    reasoning: Math.min(left.reasoning, right.reasoning),
  };
}

function hasNegative(delta: TokenDelta): boolean {
  return DELTA_FIELDS.some((field) => delta[field] < 0);
}

export function isZeroTokens(tokens: LedgerTokens): boolean {
  return DELTA_FIELDS.every((field) => tokens[field] === 0);
}

function nonZero(tokens: LedgerTokens): LedgerTokens | null {
  return isZeroTokens(tokens) ? null : tokens;
}

export function computeIncrement(args: {
  dialect: UsageDialect;
  baseline: StreamBaseline | null;
  providerThreadId: string;
  firstTotalIsOwn: boolean;
  total: LedgerTokens;
  last: LedgerTokens;
}): UsageIncrement {
  const baseline: StreamBaseline = {
    providerThreadId: args.providerThreadId,
    lastTotal: args.total,
  };
  const previous =
    args.baseline !== null &&
    args.baseline.providerThreadId === args.providerThreadId
      ? args.baseline.lastTotal
      : null;
  if (args.dialect === "codex") {
    const growth = previous === null ? null : subtract(args.total, previous);
    const delta = growth === null || hasNegative(growth) ? args.total : growth;
    const live = withTotal(smallest(delta, args.last));
    const unseenIsOwn =
      previous !== null || (args.baseline === null && args.firstTotalIsOwn);
    return {
      live: nonZero(live),
      backfill: unseenIsOwn ? nonZero(withTotal(subtract(delta, live))) : null,
      baseline,
    };
  }
  const continuing =
    previous !== null && !hasNegative(subtract(args.total, previous));
  const gap =
    continuing && previous !== null
      ? subtract(subtract(args.total, previous), args.last)
      : subtract(args.total, args.last);
  return {
    live: nonZero(args.last),
    backfill: nonZero(withTotal(gap)),
    baseline,
  };
}
