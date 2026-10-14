import type { TreeNode } from "./notes-tree.js";

export function expandedFoldersStorageKey(pluginId: string): string {
  return `bb.${pluginId}.expanded-folders.v1`;
}

export function readExpandedFolders(storageKey: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

export function storeExpandedFolders(
  storageKey: string,
  paths: ReadonlySet<string>,
): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...paths]));
  } catch {
    return;
  }
}

export function retainExistingFolders(
  paths: ReadonlySet<string>,
  nodes: readonly TreeNode[],
): ReadonlySet<string> {
  const directories = new Set<string>();
  const visit = (node: TreeNode): void => {
    if (node.kind !== "directory") return;
    directories.add(node.path);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  const kept = [...paths].filter((path) => directories.has(path));
  return kept.length === paths.size ? paths : new Set(kept);
}

export function moveExpandedFolders(
  paths: ReadonlySet<string>,
  from: string,
  to: string,
): ReadonlySet<string> {
  let moved = false;
  const next = new Set<string>();
  for (const path of paths) {
    if (path === from || path.startsWith(`${from}/`)) {
      next.add(`${to}${path.slice(from.length)}`);
      moved = true;
    } else {
      next.add(path);
    }
  }
  return moved ? next : paths;
}
