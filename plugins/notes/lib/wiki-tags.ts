import path from "node:path";
import { z } from "zod";
import { expandHomePath } from "./notes-path.js";

const MAX_TAG_LENGTH = 80;

const DEFAULT_DOC_TYPE = "topic";

export const wikiTagSchema = z.object({
  tag: z.string(),
  title: z.string(),
  type: z.string(),
  aliases: z.array(z.string()),
});

export type WikiTag = z.infer<typeof wikiTagSchema>;

export const wikiTagsResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("off") }),
  z.object({ status: z.literal("unchanged") }),
  z.object({
    status: z.literal("ok"),
    mtimeMs: z.number(),
    tags: z.array(wikiTagSchema),
  }),
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("invalid") }),
]);

export type WikiTagsResult = z.infer<typeof wikiTagsResultSchema>;

const tagsFileSchema = z.object({
  version: z.literal(1),
  docs: z.array(z.unknown()),
});

const tagsFileDocSchema = z.object({
  tag: z.string(),
  title: z.string().catch(""),
  type: z.string().catch(""),
  aliases: z.array(z.string().catch("")).catch([]),
});

function kebab(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWikiTag(raw: string): string | null {
  const normalized = kebab(raw.trim().replace(/^@+/, ""))
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/, "");
  return normalized === "" ? null : normalized;
}

function normalizeAliases(raw: readonly string[], tag: string): string[] {
  const aliases = new Set<string>();
  for (const value of raw) {
    const alias = normalizeWikiTag(value);
    if (alias !== null && alias !== tag) aliases.add(alias);
  }
  return [...aliases];
}

function toWikiTag(entry: unknown): WikiTag | null {
  const parsed = tagsFileDocSchema.safeParse(entry);
  if (!parsed.success) return null;
  const tag = normalizeWikiTag(parsed.data.tag);
  if (tag === null) return null;
  const title = parsed.data.title.trim();
  const type = parsed.data.type.trim();
  return {
    tag,
    title: title === "" ? tag : title,
    type: type === "" ? DEFAULT_DOC_TYPE : type,
    aliases: normalizeAliases(parsed.data.aliases, tag),
  };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function parseWikiTags(content: string): WikiTag[] | null {
  const file = tagsFileSchema.safeParse(parseJson(content));
  if (!file.success) return null;
  const seen = new Set<string>();
  const tags: WikiTag[] = [];
  for (const entry of file.data.docs) {
    const tag = toWikiTag(entry);
    if (tag === null || seen.has(tag.tag)) continue;
    seen.add(tag.tag);
    tags.push(tag);
  }
  return tags;
}

export function resolveWikiTagsPath(
  rawPath: string | undefined,
  homeDirectory: string,
): string | null {
  const trimmed = rawPath?.trim() ?? "";
  if (trimmed === "") return null;
  const expanded = expandHomePath(trimmed, homeDirectory);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : null;
}
