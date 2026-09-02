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
