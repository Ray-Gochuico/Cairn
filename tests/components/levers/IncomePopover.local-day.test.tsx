import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import IncomePopover from '@/components/whatif/levers/IncomePopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import { FilingStatus } from '@/types/enums';
import type { Scenario } from '@/types/scenario';

/**
 * v1.7.0 R4 smoke regression: a new income event's When defaulted to the UTC
 * day, while the What-If projection starts in the LOCAL month — on a month's
 * last local evening west of UTC the default event landed a month late, and
 * on a local 1st east of UTC in the month before the projection starts. It is
 * now the local day. (IncomePopover.test.tsx reads the real clock under the
 * frozen test-clock allowlist, so these clock-pinned arms live here.)
 */
function seedStores() {
  const base = { isLoading: false, error: null };
  useHouseholdStore.setState({
    household: { filingStatus: FilingStatus.SINGLE, state: 'CA', city: null } as never, ...base,
  });
  usePersonsStore.setState({ persons: [{ id: 1, annualSalaryPretax: 135000 } as never], ...base });
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    ...base,
    horizonMonths: 360,
    inflation: 0.025, defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as never,
  });
  useTaxRulesStore.setState({ items: [], ...base } as never);
  useLoansStore.setState({ loans: [], ...base } as never);
  useAccountsStore.setState({ accounts: [], ...base } as never);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as never);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as never);
}

describe('IncomePopover — a new event\'s When is the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    seedStores();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  async function addEventWhen(): Promise<string> {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    return (screen.getByLabelText('When') as HTMLInputElement).value;
  }

  it('New York, 23:33 EDT on Sep 30 (03:33 UTC Oct 1): September 30', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-10-01T03:33:00Z'));
    expect(await addEventWhen()).toBe('2026-09-30');
  });

  it('Pacific/Auckland, 10:00 NZDT on Oct 1 (21:00 UTC Sep 30): October 1', async () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-09-30T21:00:00Z'));
    expect(await addEventWhen()).toBe('2026-10-01');
  });
});
