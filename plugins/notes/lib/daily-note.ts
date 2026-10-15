import type { FlatEntry } from "./notes-tree.js";

/**
 * Finds the note named for `date` anywhere in the tree, so opening the panel
 * lands on today's note.
 *
 * Accepts `MM-DD-YY.md` and, because older notes were saved that way, an
 * unpadded month (`M-DD-YY.md`). Returns null when no such note exists.
 */
export function findDailyNotePath(
  entries: readonly FlatEntry[],
  date: Date,
): string | null {
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear() % 100).padStart(2, "0");
  const names = new Set([
    `${month.padStart(2, "0")}-${day}-${year}.md`,
    `${month}-${day}-${year}.md`,
  ]);
  const match = entries.find(
    (entry) =>
      entry.kind === "file" && names.has(entry.path.split("/").at(-1) ?? ""),
  );
  return match?.path ?? null;
}
