import { describe, it, expect, beforeEach } from 'vitest';
import { useInterviewBarStore, INTERVIEW_BAR_KEY } from '@/lib/interview/bar-store';

describe('interview bar store (D-GI13: session-only hypothetical)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useInterviewBarStore.setState({ amount: null, cadence: 'one-time', submitted: null });
  });

  it('submit snapshots the CURRENT amount+cadence in cents and persists to sessionStorage', () => {
    const s = useInterviewBarStore.getState();
    s.setAmount(10000);
    s.setCadence('per-month');
    useInterviewBarStore.getState().submit();
    expect(useInterviewBarStore.getState().submitted).toEqual({ amountCents: 1_000_000, cadence: 'per-month' });
    expect(JSON.parse(sessionStorage.getItem(INTERVIEW_BAR_KEY)!)).toEqual({ amountCents: 1_000_000, cadence: 'per-month' });
  });

  it('clear removes the submission + the sessionStorage key', () => {
    const s = useInterviewBarStore.getState();
    s.setAmount(50);
    s.submit();
    useInterviewBarStore.getState().clear();
    expect(useInterviewBarStore.getState().submitted).toBeNull();
    expect(sessionStorage.getItem(INTERVIEW_BAR_KEY)).toBeNull();
  });

  it('fractional dollars round to integer cents', () => {
    const s = useInterviewBarStore.getState();
    s.setAmount(10.505);
    s.submit();
    expect(useInterviewBarStore.getState().submitted!.amountCents).toBe(1051);
  });
});
