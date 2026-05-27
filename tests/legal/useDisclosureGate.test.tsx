import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { useHouseholdStore } from '@/stores/household-store';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

const baseHousehold: Household = {
  id: 1,
  name: null,
  filingStatus: FilingStatus.SINGLE,
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 5000,
  withdrawalRate: 0.04,
  inflationAssumption: 0.03,
  growthScenarios: [],
  disclaimerAcceptedAt: null,
  disclaimerVersionAccepted: null,
  roadmapDisclaimerAcceptedAt: null,
  roadmapDisclaimerVersionAccepted: null,
};

function setHousehold(patch: Partial<Household>) {
  useHouseholdStore.setState({
    household: { ...baseHousehold, ...patch },
    isLoading: false,
    error: null,
  });
}

describe('useDisclosureGate', () => {
  beforeEach(() => {
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  it('returns needs-acceptance when household is null', () => {
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('returns needs-acceptance when the accepted version is null', () => {
    setHousehold({ disclaimerVersionAccepted: null });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
    if (result.current.state === 'needs-acceptance') {
      expect(result.current.document.id).toBe('app_wide');
      expect(result.current.document.version).toBe('1.5');
    }
  });

  it('returns ready when the accepted version matches the current version', () => {
    setHousehold({ disclaimerVersionAccepted: '1.5' });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('ready');
  });

  it('returns needs-acceptance when the accepted version is stale (v1.0)', () => {
    // A user on the now-superseded v1.0 must be re-prompted at app_wide v1.5.
    setHousehold({ disclaimerVersionAccepted: '1.0' });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('returns needs-acceptance when the accepted version is stale (v1.1 → v1.5)', () => {
    // A user on v1.1 (which shipped with the [PLACEHOLDER] governing-law
    // string) must be re-prompted at v1.5 (which adds drawdown gross-up +
    // frozen-bracket bullets to the "what we don't model" tax-items list).
    setHousehold({ disclaimerVersionAccepted: '1.1' });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('returns needs-acceptance when the accepted version is stale (v1.2 → v1.5)', () => {
    // A user on v1.2 (governing-law sentence only) must be re-prompted at
    // v1.5 (which added the unmodeled-items list at v1.3, bumped the WA
    // threshold at v1.4, and added drawdown gross-up + frozen-brackets at v1.5).
    setHousehold({ disclaimerVersionAccepted: '1.2' });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('returns needs-acceptance when the accepted version is stale (v1.3 → v1.5)', () => {
    // A user on v1.3 must be re-prompted at v1.5.
    setHousehold({ disclaimerVersionAccepted: '1.3' });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('returns needs-acceptance when the accepted version is stale (v1.4 → v1.5)', () => {
    // A user on v1.4 (current as of Wave-6) must be re-prompted at v1.5
    // (which added drawdown gross-up + frozen-brackets bullets).
    setHousehold({ disclaimerVersionAccepted: '1.4' });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('reads the roadmap version cache when id is roadmap', () => {
    setHousehold({ disclaimerVersionAccepted: '1.5', roadmapDisclaimerVersionAccepted: null });
    const { result } = renderHook(() => useDisclosureGate('roadmap'));
    expect(result.current.state).toBe('needs-acceptance');
    if (result.current.state === 'needs-acceptance') {
      expect(result.current.document.id).toBe('roadmap');
    }
  });

  it('app_wide and roadmap gates are independent', () => {
    setHousehold({ disclaimerVersionAccepted: '1.5', roadmapDisclaimerVersionAccepted: '1.0' });
    const appWide = renderHook(() => useDisclosureGate('app_wide'));
    const roadmap = renderHook(() => useDisclosureGate('roadmap'));
    expect(appWide.result.current.state).toBe('ready');
    expect(roadmap.result.current.state).toBe('ready');
  });
});
