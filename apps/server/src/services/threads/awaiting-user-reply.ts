import { z } from "zod";
import { getLatestThreadOutputEventRow, type DbConnection } from "@bb/db";

/**
 * Closings that ask the user for a decision or an instruction. Deliberately
 * excludes the courtesies that end a report without needing anything back
 * ("let me know", "your call", "up to you", "say the word"): they read as an
 * open door rather than a question, and tinting on them made finished threads
 * look like blocked ones.
 */
const EXPLICIT_REQUEST_PATTERNS: readonly RegExp[] = [
  /\bwant me to\b/iu,
  /\bshould i\b/iu,
  /\bshall i\b/iu,
  /\btell me (which|what|where|if|whether)\b/iu,
  /\bconfirm (which|whether|if)\b/iu,
];

const FENCE_DELIMITER = /^\s*(```|~~~)/u;

function toClosingPassage(text: string): string | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const closingLine = lines.at(-1);
  if (closingLine === undefined || FENCE_DELIMITER.test(closingLine)) {
    return null;
  }
  const sentences = closingLine
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return sentences.at(-1) ?? null;
}

/**
 * Whether an agent's closing passage puts the turn back on the user. Only the
 * last sentence of the last line counts: a long report routinely asks and
 * answers its own questions along the way, and a bullet list ending in a
 * finding is not a question just because an earlier bullet contained one.
 *
 * Deliberately a text heuristic over the passage bb already stores, not a
 * provider signal: no provider reports "I asked a question", and the
 * alternative is a second model call per turn. It reads a question mark or one
 * of a few explicit hand-backs, so it misses questions phrased as statements;
 * the row simply stays untinted in that case.
 */
export function closingPassageAsksUser(text: string): boolean {
  const closing = toClosingPassage(text);
  if (closing === null) {
    return false;
  }
  if (closing.includes("?")) {
    return true;
  }
  return EXPLICIT_REQUEST_PATTERNS.some((pattern) => pattern.test(closing));
}

const closingAgentMessageSchema = z.object({
  item: z.object({
    type: z.literal("agentMessage"),
    text: z.string(),
  }),
});

function readClosingAgentMessage(
  db: DbConnection,
  threadId: string,
): string | null {
  const row = getLatestThreadOutputEventRow(db, { threadId });
  if (!row || row.type !== "item/completed") {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.data);
  } catch {
    return null;
  }
  const parsed = closingAgentMessageSchema.safeParse(decoded);
  return parsed.success ? parsed.data.item.text : null;
}

/**
 * Whether the thread's last completed turn left a question with its user.
 *
 * Reads only the fields it needs off the stored row and tolerates one it
 * cannot decode: the answer decides a sidebar tint, and a turn has to settle
 * even when its closing message is missing, truncated, or written by an
 * older event shape.
 */
export function resolveAwaitingUserReply(
  db: DbConnection,
  threadId: string,
): boolean {
  const closing = readClosingAgentMessage(db, threadId);
  return closing === null ? false : closingPassageAsksUser(closing);
}
