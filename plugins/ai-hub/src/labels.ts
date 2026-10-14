import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";

const LIST_TTL_MS = 60_000;
const MODELS_TTL_MS = 10 * 60_000;
const RETRY_AFTER_MS = 20_000;
const LOOKUP_TIMEOUT_MS = 5_000;

const projectListSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string() }).loose(),
);
const providerListSchema = z.array(
  z.object({ id: z.string().min(1), displayName: z.string() }).loose(),
);
const modelListSchema = z
  .object({
    models: z.array(
      z
        .object({
          id: z.string(),
          model: z.string(),
          displayName: z.string(),
        })
        .loose(),
    ),
    modelLoadError: z.object({ code: z.string() }).loose().nullish(),
  })
  .loose();

export interface Labels {
  project(projectId: string | null): string | null;
  provider(providerId: string): string;
  model(model: string | null): string | null;
}

export interface LabelSource {
  resolve(args: { providerIds: readonly string[] }): Promise<Labels>;
}

export interface LabelSdk {
  projects: {
    list(args: {
      includePersonal: boolean;
      signal?: AbortSignal;
    }): Promise<unknown>;
  };
  providers: {
    list(args: { signal?: AbortSignal }): Promise<unknown>;
    models(args: {
      providerId: string;
      signal?: AbortSignal;
    }): Promise<unknown>;
  };
}

const BRACKET_SUFFIX = /^(.+)\[([^\]]+)\]$/;

export function createLabels(args: {
  projects: ReadonlyMap<string, string>;
  providers: ReadonlyMap<string, string>;
  models: ReadonlyMap<string, string>;
}): Labels {
  return {
    project: (projectId) =>
      projectId === null ? null : (args.projects.get(projectId) ?? null),
    provider: (providerId) => args.providers.get(providerId) ?? providerId,
    model(model) {
      if (model === null) return null;
      const exact = args.models.get(model);
      if (exact !== undefined) return exact;
      const match = BRACKET_SUFFIX.exec(model);
      const base =
        match?.[1] === undefined ? undefined : args.models.get(match[1]);
      if (base !== undefined && match?.[2] !== undefined) {
        return `${base} (${match[2].toUpperCase()})`;
      }
      return model;
    },
  };
}

interface Loaded<T> {
  value: T;
  complete: boolean;
}

interface CachedLookup<T> {
  get(): T | Promise<T>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSdkLabelSource(deps: {
  sdk: () => LabelSdk;
  log: PluginLogger;
  now: () => number;
}): LabelSource {
  function cachedLookup<T>(args: {
    ttlMs: number;
    fallback: T;
    what: string;
    load: (signal: AbortSignal) => Promise<Loaded<T>>;
  }): CachedLookup<T> {
    let current: { value: T; expiresAt: number } | null = null;
    let pending: Promise<T> | null = null;

    function refresh(): Promise<T> {
      pending ??= args
        .load(AbortSignal.timeout(LOOKUP_TIMEOUT_MS))
        .then(
          (loaded) => {
            current = {
              value: loaded.value,
              expiresAt:
                deps.now() + (loaded.complete ? args.ttlMs : RETRY_AFTER_MS),
            };
            return loaded.value;
          },
          (error: unknown) => {
            deps.log.warn(
              `AI Hub could not read ${args.what}: ${errorText(error)}`,
            );
            const value = current?.value ?? args.fallback;
            current = { value, expiresAt: deps.now() + RETRY_AFTER_MS };
            return value;
          },
        )
        .finally(() => {
          pending = null;
        });
      return pending;
    }

    return {
      get() {
        if (current === null) return refresh();
        if (current.expiresAt <= deps.now()) void refresh();
        return current.value;
      },
    };
  }

  const projects = cachedLookup({
    ttlMs: LIST_TTL_MS,
    fallback: new Map<string, string>(),
    what: "project names",
    load: async (signal) => ({
      value: new Map(
        projectListSchema
          .parse(
            await deps.sdk().projects.list({ includePersonal: true, signal }),
          )
          .map((project) => [project.id, project.name]),
      ),
      complete: true,
    }),
  });
  const providers = cachedLookup({
    ttlMs: LIST_TTL_MS,
    fallback: new Map<string, string>(),
    what: "provider names",
    load: async (signal) => ({
      value: new Map(
        providerListSchema
          .parse(await deps.sdk().providers.list({ signal }))
          .map((provider) => [provider.id, provider.displayName]),
      ),
      complete: true,
    }),
  });
  const models = new Map<string, CachedLookup<Map<string, string>>>();

  function modelsOf(providerId: string): CachedLookup<Map<string, string>> {
    const existing = models.get(providerId);
    if (existing !== undefined) return existing;
    const created = cachedLookup({
      ttlMs: MODELS_TTL_MS,
      fallback: new Map<string, string>(),
      what: `the ${providerId} model names`,
      load: async (signal) => {
        const result = modelListSchema.parse(
          await deps.sdk().providers.models({ providerId, signal }),
        );
        return {
          value: new Map(
            result.models.flatMap((model) => [
              [model.model, model.displayName] as const,
              [model.id, model.displayName] as const,
            ]),
          ),
          complete: !result.modelLoadError,
        };
      },
    });
    models.set(providerId, created);
    return created;
  }

  return {
    async resolve({ providerIds }) {
      const projectNames = projects.get();
      const providerNames = providers.get();
      const modelLists = [...new Set(providerIds)].map((providerId) =>
        modelsOf(providerId).get(),
      );
      const modelNames = new Map<string, string>();
      for (const names of await Promise.all(modelLists)) {
        for (const [id, name] of names) {
          if (!modelNames.has(id)) modelNames.set(id, name);
        }
      }
      return createLabels({
        projects: await projectNames,
        providers: await providerNames,
        models: modelNames,
      });
    },
  };
}
