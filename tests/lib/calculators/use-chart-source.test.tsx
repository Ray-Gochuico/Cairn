import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChartSource, useGatedReturnSource } from '@/lib/calculators/use-chart-source';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { clearExploreFlag, clearExplorePrefs, setExploreFlag } from '@/lib/explore-mode';

beforeEach(() => {
  sessionStorage.clear();
  useAcceptancesStore.setState({ acceptedVersions: {} });
});

const accept = () =>
  useAcceptancesStore.setState({
    acceptedVersions: { backtest: DISCLOSURES.backtest.version },
  });

describe('useChartSource (D-UB3)', () => {
  it('defaults to ASSUMED and persists per card', () => {
    const { result } = renderHook(() => useChartSource('path-to-fi'));
    expect(result.current[0]).toBe('ASSUMED');
    act(() => result.current[1]('HISTORY'));
    expect(result.current[0]).toBe('HISTORY');
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBe('HISTORY');
    // Another card's key is independent:
    expect(sessionStorage.getItem('calc-chart-source:compound-interest')).toBeNull();
  });
  it('rehydrates from sessionStorage; unknown values fall back to ASSUMED', () => {
    sessionStorage.setItem('calc-chart-source:path-to-fi', 'HISTORY');
    expect(renderHook(() => useChartSource('path-to-fi')).result.current[0]).toBe('HISTORY');
    sessionStorage.setItem('calc-chart-source:path-to-fi', 'garbage');
    expect(renderHook(() => useChartSource('path-to-fi')).result.current[0]).toBe('ASSUMED');
  });
});

describe('useGatedReturnSource (D-UB10 deferred gate + restart-safe demotion)', () => {
  it('un-accepted: requestHistory opens the gate instead of switching', () => {
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.requestHistory());
    expect(result.current.source).toBe('ASSUMED');
    expect(result.current.gateDocument?.id).toBe('backtest');
  });
  it('cancel keeps Assumed and closes the gate', () => {
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.requestHistory());
    act(() => result.current.cancelGate());
    expect(result.current.source).toBe('ASSUMED');
    expect(result.current.gateDocument).toBeNull();
  });
  it('accepted: requestHistory switches directly, no gate', () => {
    accept();
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.requestHistory());
    expect(result.current.source).toBe('HISTORY');
    expect(result.current.gateDocument).toBeNull();
  });
  it('RESTART-SAFE: stored HISTORY + un-accepted gate ⇒ effective source is ASSUMED', () => {
    sessionStorage.setItem('calc-chart-source:path-to-fi', 'HISTORY');
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    expect(result.current.source).toBe('ASSUMED');
    accept();
    // On the next render the stored selection surfaces:
    expect(renderHook(() => useGatedReturnSource('path-to-fi')).result.current.source).toBe(
      'HISTORY',
    );
  });
  /* W2 review fix (MINOR 11): every Assumed click in the suites happened AFTER
     acceptance, so D-UB10's "the Assumed view never gates" had no pin — a
     selectAssumed that opened the gate survived all three files. */
  it('un-accepted: selectAssumed NEVER opens the gate (D-UB10)', () => {
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.selectAssumed());
    expect(result.current.source).toBe('ASSUMED');
    expect(result.current.gateDocument).toBeNull();
    // …and still not after the gate has been opened and cancelled once.
    act(() => result.current.requestHistory());
    act(() => result.current.cancelGate());
    act(() => result.current.selectAssumed());
    expect(result.current.gateDocument).toBeNull();
  });
  /* W2 review fix (MINOR 10): v1.4's real transition is 1.3 ⇒ re-gate, and no
     test seeded '1.3' anywhere — a gate that grandfathered 1.3 accepters
     survived 81 tests. */
  it('an accepted v1.3 is re-gated on first History activation (the v1.4 transition)', () => {
    useAcceptancesStore.setState({ acceptedVersions: { backtest: '1.3' } });
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.requestHistory());
    expect(result.current.source).toBe('ASSUMED');
    expect(result.current.gateDocument?.version).toBe(DISCLOSURES.backtest.version);
  });
  it('selectAssumed returns to the assumed view and persists it', () => {
    accept();
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.requestHistory());
    act(() => result.current.selectAssumed());
    expect(result.current.source).toBe('ASSUMED');
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBe('ASSUMED');
  });
  it('a view switch never touches calculator override state', () => {
    accept();
    const { result } = renderHook(() => useGatedReturnSource('path-to-fi'));
    act(() => result.current.requestHistory());
    // No calc-state key is written — only the view key:
    const keys = Object.keys(sessionStorage).filter((k) => !k.startsWith('calc-chart-source:'));
    expect(keys.filter((k) => k.startsWith('calc-state:'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// W4 pref ratchet (the dollar-basis precedent, 2026-09-02): the return-source
// key is NAMESPACED, so an explore session leaves nothing behind. The ratchet
// itself only proves the file CALLS prefKey — this pins BOTH sides of the
// composed key and the sweep.
// ---------------------------------------------------------------------------
describe('useChartSource under explore mode (W4 pref ratchet)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    clearExploreFlag();
    sessionStorage.clear();
  });

  it('writes the namespaced key while exploring, and the sweep reaps it', () => {
    setExploreFlag();
    const { result } = renderHook(() => useChartSource('path-to-fi'));
    act(() => result.current[1]('HISTORY'));

    expect(sessionStorage.getItem('explore.calc-chart-source:path-to-fi')).toBe('HISTORY');
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBeNull();

    clearExplorePrefs();
    clearExploreFlag();
    expect(sessionStorage.getItem('explore.calc-chart-source:path-to-fi')).toBeNull();
    expect(renderHook(() => useChartSource('path-to-fi')).result.current[0]).toBe('ASSUMED');
  });

  it('writes the bare key with the flag unset (the real profile is unprefixed)', () => {
    const { result } = renderHook(() => useChartSource('path-to-fi'));
    act(() => result.current[1]('HISTORY'));
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBe('HISTORY');
    expect(sessionStorage.getItem('explore.calc-chart-source:path-to-fi')).toBeNull();
  });

  it('an explore-era selection never seeds the real read (the leak this prevents)', () => {
    setExploreFlag();
    const { result } = renderHook(() => useChartSource('path-to-fi'));
    act(() => result.current[1]('HISTORY'));
    // Exit WITHOUT the sweep: the stranded explore key is invisible to the real
    // profile, because the real read composes an unprefixed key.
    clearExploreFlag();
    expect(renderHook(() => useChartSource('path-to-fi')).result.current[0]).toBe('ASSUMED');
    expect(sessionStorage.getItem('explore.calc-chart-source:path-to-fi')).toBe('HISTORY');
  });
});
