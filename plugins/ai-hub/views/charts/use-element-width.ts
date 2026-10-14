import { useEffect, useState } from "react";

export function useElementWidth<T extends HTMLElement>(
  fallback: number,
): { ref: (node: T | null) => void; width: number } {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref: setNode, width: width > 0 ? width : fallback };
}
