import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CALCULATORS_PAGE_ID,
  __readInitialDollarBasisForTests,
  __resetDollarBasisForTests,
  useDollarBasis,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { clearExploreFlag, clearExplorePrefs, setExploreFlag } from '@/lib/explore-mode';

describe('useDollarBasis (W5 D-T2/D-T3/D-T8)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it("defaults to 'today' — the honest cold-boot basis (D-T3)", () => {
    const { result } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    expect(result.current[0]).toBe('today');
  });

  it("set('future') persists under calc-basis:{pageId} and updates the hook", () => {
    const { result } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    act(() => result.current[1]('future'));
    expect(result.current[0]).toBe('future');
    expect(sessionStorage.getItem('calc-basis:calculators')).toBe('future');
  });

  it('reads a persisted value on first render (same-session client-side nav)', () => {
    sessionStorage.setItem('calc-basis:calculators', 'future');
    const { result } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    expect(result.current[0]).toBe('future');
  });

  it("corrupt stored values fall back to 'today' — never to nominal", () => {
    sessionStorage.setItem('calc-basis:calculators', 'NOMINAL');
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('today');
    sessionStorage.setItem('calc-basis:calculators', 'garbage');
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('today');
    sessionStorage.setItem('calc-basis:calculators', 'future');
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('future');
  });

  it("the whitelist is EXACT: 'future' is the only non-default literal (D-T3)", () => {
    // Review fix (MINOR 10): the pair above pins one legacy vocabulary word
    // and one random string, so a shim that also accepted a near-miss casing
    // or a padded literal as 'future' survived. Every near miss is a today.
    const nearMisses = [
      'today ',
      'TODAY',
      'Today',
      'nominal',
      'NOMINAL',
      'REAL',
      'real',
      'Future',
      'FUTURE',
      'future ',
      ' future',
      'future\n',
      '',
      'null',
      'undefined',
    ];
    for (const v of nearMisses) {
      sessionStorage.setItem('calc-basis:calculators', v);
      expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID), JSON.stringify(v)).toBe(
        'today',
      );
    }
    sessionStorage.removeItem('calc-basis:calculators');
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('today');
    sessionStorage.setItem('calc-basis:calculators', 'future');
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('future');
  });

  it('pages are isolated: a whatif basis never leaks into calculators (the W5.1 seam)', () => {
    const { result } = renderHook(() => useDollarBasis('whatif'));
    act(() => result.current[1]('future'));
    const { result: calc } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    expect(calc.current[0]).toBe('today');
    expect(sessionStorage.getItem('calc-basis:whatif')).toBe('future');
    expect(sessionStorage.getItem('calc-basis:calculators')).toBeNull();
  });

  it('two subscribers stay in sync through the store (the next-dollar idiom)', () => {
    const a = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    const b = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(a.result.current[0]).toBe('future');
    expect(b.result.current[0]).toBe('future');
  });
});

// ---------------------------------------------------------------------------
// W4×W5 merge reconciliation (coordinator ruling, 2026-09-02): the basis key
// is NAMESPACED under W4's explore ratchet, so an explore session leaves
// nothing behind — `clearExplorePrefs()` sweeps the whole `explore.` family
// on the way out. The pair below pins BOTH sides of prefKey(): the ratchet
// itself only proves the file CALLS prefKey, not that the composed key is
// right.
// ---------------------------------------------------------------------------
describe('useDollarBasis under explore mode (W4 pref ratchet)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    __resetDollarBasisForTests();
  });

  // Storage only — no store writes. A `__resetDollarBasisForTests()` here
  // would run BEFORE RTL's own cleanup (inner afterEach first), so the
  // zustand write would re-render a still-mounted hook outside act().
  afterEach(() => {
    clearExploreFlag();
    sessionStorage.clear();
  });

  it('writes the namespaced key while exploring, and the sweep reaps it', () => {
    setExploreFlag();
    const { result } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    act(() => result.current[1]('future'));

    expect(sessionStorage.getItem('explore.calc-basis:calculators')).toBe('future');
    // The real profile's own key was never touched.
    expect(sessionStorage.getItem('calc-basis:calculators')).toBeNull();

    // Exit: the prefix sweep reaps it, so the real session reads a clean default.
    clearExplorePrefs();
    clearExploreFlag();
    expect(sessionStorage.getItem('explore.calc-basis:calculators')).toBeNull();
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('today');
  });

  it('writes the bare key with the flag unset (the real profile is unprefixed)', () => {
    const { result } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    act(() => result.current[1]('future'));

    expect(sessionStorage.getItem('calc-basis:calculators')).toBe('future');
    expect(sessionStorage.getItem('explore.calc-basis:calculators')).toBeNull();
  });

  it('an explore-era basis never seeds the real read (the leak this prevents)', () => {
    setExploreFlag();
    const { result } = renderHook(() => useDollarBasis(CALCULATORS_PAGE_ID));
    act(() => result.current[1]('future'));

    // Exit WITHOUT the sweep: even a stranded explore key is invisible to the
    // real profile, because the real read composes an unprefixed key.
    clearExploreFlag();
    act(() => __resetDollarBasisForTests()); // the hook above is still mounted
    expect(__readInitialDollarBasisForTests(CALCULATORS_PAGE_ID)).toBe('today');
    expect(sessionStorage.getItem('explore.calc-basis:calculators')).toBe('future');
  });
});
