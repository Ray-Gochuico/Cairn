import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSurplusFlowPreview } from '@/components/whatif/useSurplusFlowPreview';
import type { LeverPayload, RealState } from '@/lib/scenarios';

// Stub the engine helper + useRealState so this is a pure unit test of the
// per-bucket return shape. The engine-side breakdown is exercised by the
// auto-invest-preview unit tests.
const STUB_REAL_STATE = { startISO: '2026-05' } as unknown as RealState;
const STUB_LEVER_PAYLOAD = { contributions: [] } as unknown as LeverPayload;

vi.mock('@/lib/scenarios', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scenarios')>('@/lib/scenarios');
  return {
    ...actual,
    currentSurplusFlow: vi.fn(() => ({
      amount: 1500,
      taxAdvantaged: 750,
      brokerage: 250,
      cash: 500,
    })),
  };
});

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => STUB_REAL_STATE,
}));

describe('useSurplusFlowPreview', () => {
  it('returns the per-bucket breakdown from currentSurplusFlow', () => {
    const { result } = renderHook(() => useSurplusFlowPreview(STUB_LEVER_PAYLOAD));
    expect(result.current).toEqual({
      amount: 1500,
      taxAdvantaged: 750,
      brokerage: 250,
      cash: 500,
    });
  });

  it('returns zeros when leverPayload is null', () => {
    const { result } = renderHook(() => useSurplusFlowPreview(null));
    expect(result.current).toEqual({ amount: 0, taxAdvantaged: 0, brokerage: 0, cash: 0 });
  });

  it('returns zeros when leverPayload is undefined', () => {
    const { result } = renderHook(() => useSurplusFlowPreview(undefined));
    expect(result.current).toEqual({ amount: 0, taxAdvantaged: 0, brokerage: 0, cash: 0 });
  });
});
