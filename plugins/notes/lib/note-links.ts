import { decodeSubPath, isMarkdownPath, parentOf } from "./notes-tree.js";

export type NoteLinkTarget =
  | { kind: "anchor"; anchor: string }
  | { kind: "note"; path: string }
  | { kind: "url"; href: string }
  | { kind: "none" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function joinRelative(directory: string, relative: string): string | null {
  const parts = directory === "" ? [] : directory.split("/");
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length === 0 ? null : parts.join("/");
}

export function resolveNoteLink(
  notePath: string,
  href: string,
): NoteLinkTarget {
  const trimmed = href.trim();
  if (trimmed.startsWith("#"))
    return { kind: "anchor", anchor: trimmed.slice(1) };
  if (SCHEME.test(trimmed) || trimmed.startsWith("//")) {
    return { kind: "url", href: trimmed };
  }
  if (trimmed === "" || trimmed.startsWith("/")) return { kind: "none" };
  const end = trimmed.search(/[?#]/);
  const relative = decodeSubPath(end === -1 ? trimmed : trimmed.slice(0, end));
  const path = joinRelative(parentOf(notePath), relative.replace(/\\/g, "/"));
  if (path === null || !isMarkdownPath(path)) return { kind: "none" };
  return { kind: "note", path };
}
