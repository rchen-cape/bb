import { describe, expect, it } from "vitest";
import { createLabels, createSdkLabelSource, type LabelSdk } from "./labels";
import { recordingLog } from "./test-fixtures";

describe("createLabels", () => {
  it("names models, keeps context suffixes, and falls back to the raw id", () => {
    const labels = createLabels({
      projects: new Map([["proj_app", "App"]]),
      providers: new Map([["codex", "Codex"]]),
      models: new Map([["claude-opus-5", "Claude Opus 5"]]),
    });

    expect(labels.model("claude-opus-5")).toBe("Claude Opus 5");
    expect(labels.model("claude-opus-5[1m]")).toBe("Claude Opus 5 (1M)");
    expect(labels.model("gpt-9")).toBe("gpt-9");
    expect(labels.model(null)).toBeNull();
    expect(labels.project("proj_app")).toBe("App");
    expect(labels.project("proj_gone")).toBeNull();
    expect(labels.provider("pi")).toBe("pi");
  });
});

describe("createSdkLabelSource", () => {
  it("caches lookups and falls back to raw ids when a lookup fails", async () => {
    const { log, warnings } = recordingLog();
    let now = 0;
    const calls: string[] = [];
    const sdk: LabelSdk = {
      projects: {
        list: async () => {
          calls.push("projects");
          return [{ id: "proj_app", name: "App" }];
        },
      },
      providers: {
        list: async () => {
          calls.push("providers");
          return [{ id: "codex", displayName: "Codex" }];
        },
        models: async ({ providerId }) => {
          calls.push(`models:${providerId}`);
          if (providerId === "pi") throw new Error("pi is not installed");
          return {
            models: [
              { id: "gpt-5.5", model: "gpt-5.5-codex", displayName: "GPT-5.5" },
            ],
          };
        },
      },
    };
    const source = createSdkLabelSource({
      sdk: () => sdk,
      log,
      now: () => now,
    });

    const first = await source.resolve({ providerIds: ["codex", "pi"] });
    expect(first.model("gpt-5.5-codex")).toBe("GPT-5.5");
    expect(first.model("gpt-5.5")).toBe("GPT-5.5");
    expect(first.provider("codex")).toBe("Codex");
    expect(warnings).toEqual([
      "AI Hub could not read the pi model names: pi is not installed",
    ]);

    now = 30_000;
    await source.resolve({ providerIds: ["codex"] });
    expect(calls).toEqual([
      "projects",
      "providers",
      "models:codex",
      "models:pi",
    ]);

    now = 61_000;
    await source.resolve({ providerIds: ["codex"] });
    expect(calls.slice(4)).toEqual(["projects", "providers"]);
  });
});

function hangUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

async function settlesWithin<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    work.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), ms);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

describe("createSdkLabelSource freshness", () => {
  function slowSource() {
    let now = 0;
    let slow = false;
    const signals: (AbortSignal | undefined)[] = [];
    const calls: string[] = [];
    const sdk: LabelSdk = {
      projects: {
        list: async ({ signal }) => {
          calls.push("projects");
          signals.push(signal);
          if (slow) return hangUntilAborted(signal);
          return [{ id: "proj_app", name: "App" }];
        },
      },
      providers: {
        list: async ({ signal }) => {
          calls.push("providers");
          signals.push(signal);
          if (slow) return hangUntilAborted(signal);
          return [{ id: "codex", displayName: "Codex" }];
        },
        models: async ({ providerId, signal }) => {
          calls.push(`models:${providerId}`);
          signals.push(signal);
          if (slow) return hangUntilAborted(signal);
          return {
            models: [
              { id: "gpt-5.5", model: "gpt-5.5-codex", displayName: "GPT-5.5" },
            ],
            modelLoadError: null,
          };
        },
      },
    };
    const source = createSdkLabelSource({
      sdk: () => sdk,
      log: recordingLog().log,
      now: () => now,
    });
    return {
      source,
      signals,
      calls,
      advance(ms: number) {
        now += ms;
      },
      goSlow() {
        slow = true;
      },
    };
  }

  it("gives every lookup a timeout signal", async () => {
    const t = slowSource();
    await t.source.resolve({ providerIds: ["codex"] });

    expect(t.signals).toHaveLength(3);
    for (const signal of t.signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
    }
  });

  it("answers from expired names at once while it refreshes them", async () => {
    const t = slowSource();
    await t.source.resolve({ providerIds: ["codex"] });
    t.goSlow();
    t.advance(11 * 60_000);

    const result = await settlesWithin(
      t.source.resolve({ providerIds: ["codex"] }),
      200,
    );

    expect(result.settled).toBe(true);
    if (!result.settled) return;
    expect(result.value.project("proj_app")).toBe("App");
    expect(result.value.provider("codex")).toBe("Codex");
    expect(result.value.model("gpt-5.5-codex")).toBe("GPT-5.5");
    expect(t.calls.slice(3)).toEqual(["projects", "providers", "models:codex"]);
  });

  it("retries a failed or incomplete model lookup after a short wait", async () => {
    const { log } = recordingLog();
    let now = 0;
    let ready = false;
    const calls: string[] = [];
    const sdk: LabelSdk = {
      projects: { list: async () => [] },
      providers: {
        list: async () => [],
        models: async ({ providerId }) => {
          calls.push(providerId);
          if (providerId === "pi" && !ready) throw new Error("not loaded yet");
          return {
            models: ready
              ? [{ id: providerId, model: providerId, displayName: "Named" }]
              : [],
            modelLoadError: ready
              ? null
              : { code: "timeout", detail: null, providerId },
          };
        },
      },
    };
    const source = createSdkLabelSource({
      sdk: () => sdk,
      log,
      now: () => now,
    });
    await source.resolve({ providerIds: ["codex", "pi"] });
    ready = true;

    now = 25_000;
    await source.resolve({ providerIds: ["codex", "pi"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const labels = await source.resolve({ providerIds: ["codex", "pi"] });

    expect(calls).toEqual(["codex", "pi", "codex", "pi"]);
    expect(labels.model("codex")).toBe("Named");
    expect(labels.model("pi")).toBe("Named");
  });
});
