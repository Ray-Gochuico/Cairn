import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrollIntoViewWhenSettled } from '@/lib/scroll-into-view-settled';

/** An element whose `top` walks the given samples (last one repeats). */
function el(tops: number[]): { node: HTMLElement; calls: ScrollIntoViewOptions[] } {
  const node = document.createElement('div');
  document.body.appendChild(node);
  let i = 0;
  node.getBoundingClientRect = () => ({ top: tops[Math.min(i++, tops.length - 1)] } as DOMRect);
  const calls: ScrollIntoViewOptions[] = [];
  node.scrollIntoView = (opts?: boolean | ScrollIntoViewOptions) => { calls.push(opts as ScrollIntoViewOptions); };
  return { node, calls };
}
const reduceMotion = (matches: boolean): void => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, addEventListener() {}, removeEventListener() {} }));
};
const setVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
};

describe('scrollIntoViewWhenSettled (C1 — the CalculatorsLayout settle idiom, shared)', () => {
  beforeEach(() => { vi.useFakeTimers(); reduceMotion(true); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (document as unknown as Record<string, unknown>).visibilityState;
    document.body.innerHTML = '';
  });

  it('never scrolls on the calling commit; scrolls ONCE after two consecutive stable 50ms samples', () => {
    const { node, calls } = el([100]);
    scrollIntoViewWhenSettled(() => node, 'start');
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(100);              // samples 1–2: stable ×1
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(50);               // sample 3: stable ×2 → scroll
    expect(calls).toEqual([{ block: 'start', behavior: 'auto' }]);
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
  });

  it('a target still moving (content above it growing) defers the scroll until it holds — the smoke M2/M3 class', () => {
    const { node, calls } = el([400, 700, 900, 900, 900]);
    scrollIntoViewWhenSettled(() => node, 'center');
    vi.advanceTimersByTime(150);              // 400 → 700 → 900: never two stable in a row
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(100);              // 900, 900
    expect(calls).toEqual([{ block: 'center', behavior: 'auto' }]);
  });

  it('a target that never settles is scrolled at the tenth sample (bounded, never abandoned)', () => {
    const { node, calls } = el(Array.from({ length: 20 }, (_, i) => i * 10));
    scrollIntoViewWhenSettled(() => node, 'nearest');
    vi.advanceTimersByTime(450);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(calls).toEqual([{ block: 'nearest', behavior: 'auto' }]);
  });

  it('smooth when motion is allowed and the tab is visible; instant when hidden (frames are throttled to zero there)', () => {
    reduceMotion(false);
    setVisibility('visible');
    const a = el([0]);
    scrollIntoViewWhenSettled(() => a.node, 'start');
    vi.advanceTimersByTime(150);
    expect(a.calls).toEqual([{ block: 'start', behavior: 'smooth' }]);
    setVisibility('hidden');
    const b = el([0]);
    scrollIntoViewWhenSettled(() => b.node, 'start');
    vi.advanceTimersByTime(150);
    expect(b.calls).toEqual([{ block: 'start', behavior: 'auto' }]);
  });

  it('reduced motion is read ONCE, at the call (a preference flip mid-poll does not matter)', () => {
    reduceMotion(true);
    setVisibility('visible');
    const { node, calls } = el([0]);
    scrollIntoViewWhenSettled(() => node, 'start');
    reduceMotion(false);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual([{ block: 'start', behavior: 'auto' }]);
  });

  // Review MINOR 2: the arrival latch needs a RECEIPT — "the scroll happened",
  // not "a scroll was armed". A consumer that latched on arming would lose the
  // scroll entirely if it unmounted mid-settle, and one that latched on every
  // tick would consume the arrival before the target held still.
  it('onScrolled fires ONCE, at the scroll itself — never on the arming commit, never after cancel, never for a missing target', () => {
    const receipts: string[] = [];
    const { node, calls } = el([100]);
    scrollIntoViewWhenSettled(() => node, 'center', () => receipts.push('scrolled'));
    expect(receipts).toEqual([]);                       // not on the arming commit
    vi.advanceTimersByTime(100);
    expect(receipts).toEqual([]);                       // not while it is still settling
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(1);
    expect(receipts).toEqual(['scrolled']);
    vi.advanceTimersByTime(1000);
    expect(receipts).toEqual(['scrolled']);             // once, not per tick

    const cancelled = el([0]);
    const cancel = scrollIntoViewWhenSettled(() => cancelled.node, 'start', () => receipts.push('cancelled-one'));
    cancel();
    vi.advanceTimersByTime(1000);
    expect(receipts).toEqual(['scrolled']);

    scrollIntoViewWhenSettled(() => null, 'start', () => receipts.push('missing-one'));
    vi.advanceTimersByTime(1000);
    expect(receipts).toEqual(['scrolled']);
  });

  it('cancel stops the poll (effect cleanup on unmount); a missing target gives up silently', () => {
    const { node, calls } = el([0]);
    const cancel = scrollIntoViewWhenSettled(() => node, 'start');
    vi.advanceTimersByTime(50);
    cancel();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
    const missing = scrollIntoViewWhenSettled(() => null, 'start');
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    missing();
  });
});
