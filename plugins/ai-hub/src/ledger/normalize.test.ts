import { describe, expect, it } from "vitest";
import { claudeUsage, codexUsage, tokens } from "../test-fixtures";
import {
  computeIncrement,
  normalizeBreakdown,
  usageDialect,
  type LedgerTokens,
  type StreamBaseline,
} from "./normalize";

function baseline(
  lastTotal: LedgerTokens,
  providerThreadId = "pt_1",
): StreamBaseline {
  return { providerThreadId, lastTotal };
}

describe("normalizeBreakdown", () => {
  it("keeps Claude input uncached and splits cache reads from writes", () => {
    expect(
      normalizeBreakdown(
        claudeUsage({ input: 10, cacheRead: 900, cacheWrite: 50, output: 40 }),
        "standard",
      ),
    ).toEqual(
      tokens({ input: 10, cacheRead: 900, cacheWrite: 50, output: 40 }),
    );
  });

  it("derives cache reads from cachedInputTokens minus writes when reads are missing", () => {
    expect(
      normalizeBreakdown(
        {
          totalTokens: 1_000,
          inputTokens: 10,
          cachedInputTokens: 950,
          cacheWriteInputTokens: 50,
          outputTokens: 40,
          reasoningOutputTokens: 0,
        },
        "standard",
      ),
    ).toEqual(
      tokens({ input: 10, cacheRead: 900, cacheWrite: 50, output: 40 }),
    );
  });

  it("removes cached tokens from Codex input and keeps reasoning inside output", () => {
    expect(
      normalizeBreakdown(
        codexUsage({ input: 1_000, cached: 800, output: 120, reasoning: 70 }),
        "codex",
      ),
    ).toEqual({
      input: 200,
      cacheRead: 800,
      cacheWrite: 0,
      output: 120,
      reasoning: 70,
      total: 1_120,
    });
  });

  it("removes Codex cache writes from input so the total matches Codex's own", () => {
    expect(
      normalizeBreakdown(
        {
          totalTokens: 100,
          inputTokens: 80,
          cachedInputTokens: 31,
          cacheReadInputTokens: 31,
          cacheWriteInputTokens: 9,
          outputTokens: 20,
          reasoningOutputTokens: 0,
        },
        "codex",
      ),
    ).toEqual({
      input: 40,
      cacheRead: 31,
      cacheWrite: 9,
      output: 20,
      reasoning: 0,
      total: 100,
    });
  });

  it("clamps negative and fractional counts to non-negative integers", () => {
    expect(
      normalizeBreakdown(
        {
          totalTokens: 0,
          inputTokens: 5,
          cachedInputTokens: 9,
          outputTokens: -3,
          reasoningOutputTokens: 1.6,
        },
        "codex",
      ),
    ).toEqual({
      input: 0,
      cacheRead: 9,
      cacheWrite: 0,
      output: 0,
      reasoning: 2,
      total: 9,
    });
  });

  it("treats only the codex provider id as cumulative", () => {
    expect(usageDialect("codex")).toBe("codex");
    expect(usageDialect("claude-code")).toBe("standard");
    expect(usageDialect("pi")).toBe("standard");
  });
});

describe("computeIncrement in last mode", () => {
  it("records last as live with no gap when the total grew by exactly last", () => {
    const result = computeIncrement({
      dialect: "standard",
      baseline: baseline(tokens({ input: 100, output: 10 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 130, output: 15 }),
      last: tokens({ input: 30, output: 5 }),
    });
    expect(result.live).toEqual(tokens({ input: 30, output: 5 }));
    expect(result.backfill).toBeNull();
    expect(result.baseline).toEqual(
      baseline(tokens({ input: 130, output: 15 })),
    );
  });

  it("turns a total that grew by more than last into a backfill gap", () => {
    const result = computeIncrement({
      dialect: "standard",
      baseline: baseline(tokens({ input: 100, output: 10 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 180, output: 25 }),
      last: tokens({ input: 30, output: 5 }),
    });
    expect(result.live).toEqual(tokens({ input: 30, output: 5 }));
    expect(result.backfill).toEqual(tokens({ input: 50, output: 10 }));
  });

  it("backfills everything before last when there is no baseline", () => {
    const result = computeIncrement({
      dialect: "standard",
      baseline: null,
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 300, cacheRead: 5_000, output: 90 }),
      last: tokens({ input: 20, cacheRead: 1_000, output: 10 }),
    });
    expect(result.live).toEqual(
      tokens({ input: 20, cacheRead: 1_000, output: 10 }),
    );
    expect(result.backfill).toEqual(
      tokens({ input: 280, cacheRead: 4_000, output: 80 }),
    );
  });

  it("treats a smaller total as a session reset and backfills only total minus last", () => {
    const result = computeIncrement({
      dialect: "standard",
      baseline: baseline(tokens({ input: 1_000, output: 100 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 70, output: 9 }),
      last: tokens({ input: 40, output: 5 }),
    });
    expect(result.live).toEqual(tokens({ input: 40, output: 5 }));
    expect(result.backfill).toEqual(tokens({ input: 30, output: 4 }));
  });

  it("ignores a baseline from a different provider thread", () => {
    const result = computeIncrement({
      dialect: "standard",
      baseline: baseline(tokens({ input: 10 }), "pt_old"),
      providerThreadId: "pt_new",
      firstTotalIsOwn: true,
      total: tokens({ input: 50 }),
      last: tokens({ input: 50 }),
    });
    expect(result.live).toEqual(tokens({ input: 50 }));
    expect(result.backfill).toBeNull();
  });

  it("records nothing for a turn that used no tokens", () => {
    const result = computeIncrement({
      dialect: "standard",
      baseline: baseline(tokens({ input: 10 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 10 }),
      last: tokens({}),
    });
    expect(result.live).toBeNull();
    expect(result.backfill).toBeNull();
  });
});

describe("computeIncrement in delta mode", () => {
  it("records a change in the cumulative total that matches the last call as live", () => {
    const result = computeIncrement({
      dialect: "codex",
      baseline: baseline(tokens({ input: 100, cacheRead: 400, output: 20 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 150, cacheRead: 900, output: 45 }),
      last: tokens({ input: 50, cacheRead: 500, output: 25 }),
    });
    expect(result.live).toEqual(
      tokens({ input: 50, cacheRead: 500, output: 25 }),
    );
    expect(result.backfill).toBeNull();
  });

  it("backfills the part of a change that the last call does not explain", () => {
    const result = computeIncrement({
      dialect: "codex",
      baseline: baseline(tokens({ input: 2_000, cacheRead: 8_000 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 102_000, cacheRead: 408_000 }),
      last: tokens({ input: 1_000, cacheRead: 4_000 }),
    });
    expect(result.live).toEqual(tokens({ input: 1_000, cacheRead: 4_000 }));
    expect(result.backfill).toEqual(
      tokens({ input: 99_000, cacheRead: 396_000 }),
    );
    expect(result.baseline.lastTotal).toEqual(
      tokens({ input: 102_000, cacheRead: 408_000 }),
    );
  });

  it("skips a repeated identical total", () => {
    const total = tokens({ input: 100, cacheRead: 400, output: 20 });
    const result = computeIncrement({
      dialect: "codex",
      baseline: baseline(total),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total,
      last: tokens({ input: 10, output: 2 }),
    });
    expect(result.live).toBeNull();
    expect(result.backfill).toBeNull();
    expect(result.baseline.lastTotal).toEqual(total);
  });

  it("splits the whole total into the last call and a backfill after a reset", () => {
    const result = computeIncrement({
      dialect: "codex",
      baseline: baseline(tokens({ input: 500, cacheRead: 4_000, output: 90 })),
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({ input: 80, cacheRead: 4_200, output: 10 }),
      last: tokens({ input: 80, cacheRead: 200, output: 10 }),
    });
    expect(result.live).toEqual(
      tokens({ input: 80, cacheRead: 200, output: 10 }),
    );
    expect(result.backfill).toEqual(tokens({ cacheRead: 4_000 }));
  });

  it("splits a first total into the last call and a backfill remainder", () => {
    const result = computeIncrement({
      dialect: "codex",
      baseline: null,
      providerThreadId: "pt_1",
      firstTotalIsOwn: true,
      total: tokens({
        input: 900,
        cacheRead: 9_000,
        output: 300,
        reasoning: 120,
      }),
      last: tokens({ input: 100, cacheRead: 1_000, output: 30, reasoning: 20 }),
    });
    expect(result.live).toEqual(
      tokens({ input: 100, cacheRead: 1_000, output: 30, reasoning: 20 }),
    );
    expect(result.backfill).toEqual(
      tokens({ input: 800, cacheRead: 8_000, output: 270, reasoning: 100 }),
    );
  });

  it("records only the last call when the first total may include usage counted elsewhere", () => {
    const result = computeIncrement({
      dialect: "codex",
      baseline: null,
      providerThreadId: "pt_fork",
      firstTotalIsOwn: false,
      total: tokens({ input: 51_000, output: 910 }),
      last: tokens({ input: 1_000, output: 10 }),
    });
    expect(result.live).toEqual(tokens({ input: 1_000, output: 10 }));
    expect(result.backfill).toBeNull();
    expect(result.baseline).toEqual(
      baseline(tokens({ input: 51_000, output: 910 }), "pt_fork"),
    );
  });

  it("records only the last call after the stream moved to another provider thread", () => {
    const result = computeIncrement({
      dialect: "codex",
      baseline: baseline(tokens({ input: 20_000, output: 2_200 }), "pt_old"),
      providerThreadId: "pt_rewound",
      firstTotalIsOwn: true,
      total: tokens({ input: 19_000, output: 2_150 }),
      last: tokens({ input: 10_000, output: 1_050 }),
    });
    expect(result.live).toEqual(tokens({ input: 10_000, output: 1_050 }));
    expect(result.backfill).toBeNull();
    expect(result.baseline).toEqual(
      baseline(tokens({ input: 19_000, output: 2_150 }), "pt_rewound"),
    );
  });
});
