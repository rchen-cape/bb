export function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Math.max(1, nice * base);
}

export function niceTicks(max: number, targetCount = 4): number[] {
  if (!(max > 0)) return [0];
  const step = niceStep(max / targetCount);
  const count = Math.ceil(max / step);
  return Array.from({ length: count + 1 }, (_, index) => index * step);
}

export function thinTickIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  const limit = Math.max(1, Math.floor(maxLabels));
  if (count <= limit) return Array.from({ length: count }, (_, index) => index);
  const stride = Math.ceil(count / limit);
  const indices: number[] = [];
  for (let index = count - 1; index >= 0; index -= stride) {
    indices.unshift(index);
  }
  return indices;
}

export interface BandLayout {
  step: number;
  barWidth: number;
  barX: (index: number) => number;
  center: (index: number) => number;
  indexAt: (x: number) => number;
}

export function bandLayout(args: {
  count: number;
  width: number;
  gap?: number;
  maxBar?: number;
}): BandLayout {
  const gap = args.gap ?? 2;
  const maxBar = args.maxBar ?? 24;
  const count = Math.max(1, args.count);
  const step = Math.max(0, args.width) / count;
  const barWidth = Math.max(
    1,
    Math.min(maxBar, step >= 12 ? step * 0.64 : step - gap),
  );
  const offset = (step - barWidth) / 2;
  return {
    step,
    barWidth,
    barX: (index) => index * step + offset,
    center: (index) => index * step + step / 2,
    indexAt: (x) =>
      step > 0 ? Math.min(count - 1, Math.max(0, Math.floor(x / step))) : 0,
  };
}

export interface StackSegment {
  seriesIndex: number;
  start: number;
  size: number;
}

export function stackSegments(
  values: readonly number[],
  unitPx: number,
  gap: number,
): StackSegment[] {
  const segments: StackSegment[] = [];
  let cursor = 0;
  values.forEach((value, seriesIndex) => {
    if (!(value > 0)) return;
    const full = value * unitPx;
    const lead = segments.length === 0 ? 0 : gap;
    segments.push({
      seriesIndex,
      start: cursor + lead,
      size: Math.max(0, full - lead),
    });
    cursor += full;
  });
  return segments;
}

export function roundedTopRectPath(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}): string {
  const { x, y, width, height } = args;
  const r = Math.max(0, Math.min(args.radius, width / 2, height));
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    "Z",
  ].join(" ");
}

export function chunkFromEnd<T>(items: readonly T[], maxChunks: number): T[][] {
  const limit = Math.max(1, Math.floor(maxChunks));
  if (items.length <= limit) return items.map((item) => [item]);
  const size = Math.ceil(items.length / limit);
  const chunks: T[][] = [];
  for (let end = items.length; end > 0; end -= size) {
    chunks.unshift(items.slice(Math.max(0, end - size), end));
  }
  if (chunks.length > 1 && (chunks[0]?.length ?? 0) < size) chunks.shift();
  return chunks;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
