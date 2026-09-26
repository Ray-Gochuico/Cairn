/**
 * Scroll an element into view once its layout has SETTLED.
 *
 * Pages that mount charts above the target keep growing for a few frames
 * after mount (Recharts measures asynchronously), so an immediate
 * scrollIntoView lands, then the content above pushes the target back below
 * the fold — the deep-link class CalculatorsLayout first fixed inline (smoke
 * item 7). Extracted here (C1); since A-11(5) (v1.7.1) its three callers —
 * the Calculators #hash deep link, the Send-to-What-If arrival ring and the
 * Investments `?manage` deep link — share this one idiom, with no inline copy.
 *
 * Polls the target's top every 50ms until it is stable for two consecutive
 * ticks (bounded at 10), then scrolls ONCE — instantly under reduced motion
 * or in a hidden tab (smooth scrolls never animate there). setTimeout, not
 * rAF: rAF never fires in a hidden/background tab, which would strand a deep
 * link opened there. The reduced-motion preference is read once, at the call.
 *
 * jsdom-safe: scrollIntoView / matchMedia / getBoundingClientRect may all be
 * absent. Returns a cancel function for effect cleanup.
 *
 * `onScrolled` (optional) is the RECEIPT: it fires exactly when the scroll
 * happens — never on the arming commit, never per tick, never after cancel,
 * never for a target that was gone. A caller latching a one-time arrival
 * (review MINOR 2) needs "it happened", not "it was armed": arming can be
 * cancelled by an unmount mid-settle, and the arrival would then be consumed
 * without the user ever seeing the scroll.
 */
export function scrollIntoViewWhenSettled(
  resolve: () => Element | null,
  block: ScrollLogicalPosition,
  onScrolled?: () => void,
): () => void {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastTop: number | null = null;
  let stableTicks = 0;
  let ticks = 0;
  let timer: number | null = null;
  const tick = (): void => {
    timer = null;
    const el = resolve();
    if (!el) return;
    const top = el.getBoundingClientRect?.().top ?? 0;
    stableTicks = lastTop !== null && Math.abs(top - lastTop) < 1 ? stableTicks + 1 : 0;
    lastTop = top;
    ticks += 1;
    if (stableTicks >= 2 || ticks >= 10) {
      const instant = reduced || document.visibilityState !== 'visible';
      el.scrollIntoView?.({ block, behavior: instant ? 'auto' : 'smooth' });
      onScrolled?.();
      return;
    }
    timer = window.setTimeout(tick, 50);
  };
  timer = window.setTimeout(tick, 50);
  return () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
}
