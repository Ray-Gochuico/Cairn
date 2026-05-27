import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSurplusFlowPreview } from '@/components/whatif/useSurplusFlowPreview';
import { useSettingsStore } from '@/stores/settings-store';
import type { LeverPayload, RealState } from '@/lib/scenarios';
import type { AppSettings } from '@/types/schema';

// Stub the engine helper + useRealState so this is a pure unit test of the
// destination branching. The engine path is already exercised by the
// auto-invest-preview unit tests.
const STUB_REAL_STATE = { startISO: '2026-05' } as unknown as RealState;
const STUB_LEVER_PAYLOAD = { contributions: [] } as unknown as LeverPayload;

vi.mock('@/lib/scenarios', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scenarios')>('@/lib/scenarios');
  return {
    ...actual,
    currentMonthlySalarySurplus: vi.fn(() => 1500),
  };
});

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => STUB_REAL_STATE,
}));

function setSettings(patch: Partial<AppSettings> | null): void {
  if (patch === null) {
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    return;
  }
  useSettingsStore.setState({
    settings: { id: 1, ...patch } as unknown as AppSettings,
    isLoading: false,
    error: null,
  });
}

describe('useSurplusFlowPreview', () => {
  beforeEach(() => {
    setSettings(null);
  });

  it('returns destination=cash when autoInvestSalarySurplus is false', () => {
    setSettings({ autoInvestSalarySurplus: false });
    const { result } = renderHook(() => useSurplusFlowPreview(STUB_LEVER_PAYLOAD));
    expect(result.current).toEqual({ amount: 1500, destination: 'cash' });
  });

  it('returns destination=cash when settings is null (unloaded)', () => {
    setSettings(null);
    const { result } = renderHook(() => useSurplusFlowPreview(STUB_LEVER_PAYLOAD));
    expect(result.current).toEqual({ amount: 1500, destination: 'cash' });
  });

  it('returns destination=cash when autoInvestSalarySurplus is missing', () => {
    setSettings({});
    const { result } = renderHook(() => useSurplusFlowPreview(STUB_LEVER_PAYLOAD));
    expect(result.current).toEqual({ amount: 1500, destination: 'cash' });
  });

  it('returns destination=investments when autoInvestSalarySurplus is true', () => {
    setSettings({ autoInvestSalarySurplus: true });
    const { result } = renderHook(() => useSurplusFlowPreview(STUB_LEVER_PAYLOAD));
    expect(result.current).toEqual({ amount: 1500, destination: 'investments' });
  });

  it('returns amount=0 when leverPayload is null', () => {
    setSettings({ autoInvestSalarySurplus: true });
    const { result } = renderHook(() => useSurplusFlowPreview(null));
    expect(result.current.amount).toBe(0);
    // Destination still mirrors the setting so consumers can render the
    // right copy even when the amount is 0.
    expect(result.current.destination).toBe('investments');
  });

  it('returns amount=0 when leverPayload is undefined', () => {
    setSettings({ autoInvestSalarySurplus: false });
    const { result } = renderHook(() => useSurplusFlowPreview(undefined));
    expect(result.current.amount).toBe(0);
    expect(result.current.destination).toBe('cash');
  });
});
