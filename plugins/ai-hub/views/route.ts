export const USAGE_SECTION_ID = "usage";
const THREAD_SEGMENT = "thread";

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function subPathSegments(subPath: string): string[] {
  return subPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);
}

export type UsageRoute =
  | { view: "dashboard" }
  | { view: "thread"; threadId: string }
  | { view: "unknown" };

export function parseUsageRoute(rest: readonly string[]): UsageRoute {
  if (rest.length === 0) return { view: "dashboard" };
  const [first, threadId, ...extra] = rest;
  if (
    first === THREAD_SEGMENT &&
    threadId !== undefined &&
    threadId.length > 0 &&
    extra.length === 0
  ) {
    return { view: "thread", threadId };
  }
  return { view: "unknown" };
}

export function usageThreadSubPath(threadId: string): string {
  return `${USAGE_SECTION_ID}/${THREAD_SEGMENT}/${threadId}`;
}
