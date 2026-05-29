import { useEffect, useRef, useState } from 'react';

/** Row span a content height needs given the grid's base auto-row + row-gap (px). */
export function spanFor(heightPx: number, baseRowPx: number, rowGapPx: number): number {
  return Math.max(1, Math.ceil((heightPx + rowGapPx) / (baseRowPx + rowGapPx)));
}

/**
 * Measures the referenced element and returns the `grid-row` span it should
 * occupy in a dense grid whose `grid-auto-rows` is `baseRowPx` and row-gap is
 * `rowGapPx`. Re-measures on resize (content changes when inputs are edited).
 */
export function useAutoRowSpan(baseRowPx = 8, rowGapPx = 16) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [span, setSpan] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setSpan(spanFor(el.getBoundingClientRect().height, baseRowPx, rowGapPx));
    measure();
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      setSpan(spanFor(height, baseRowPx, rowGapPx));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseRowPx, rowGapPx]);
  return { ref, span };
}
