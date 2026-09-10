import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ManageScenariosModal } from '@/components/whatif/ManageScenariosModal';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { Milestones } from '@/lib/scenarios';

const baseline: Scenario = {
  id: 1,
  name: 'Baseline',
  isBaseline: true,
  color: '#4f86f7',
  lineStyle: 'solid',
  visible: true,
  isActive: true,
  sortOrder: 0,
  leverPayload: emptyLeverPayload(),
  createdAt: '2026-05-24T00:00:00Z',
  updatedAt: '2026-05-24T00:00:00Z',
};
const scenarioA: Scenario = {
  id: 2,
  name: 'Aggressive payoff',
  isBaseline: false,
  color: '#f59e0b',
  lineStyle: 'dashed',
  visible: true,
  isActive: false,
  sortOrder: 1,
  leverPayload: { ...emptyLeverPayload(), extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }] },
  createdAt: '2026-05-24T00:00:00Z',
  updatedAt: '2026-05-24T00:00:00Z',
};

const duplicate = vi.fn().mockResolvedValue(3);
const remove = vi.fn().mockResolvedValue(undefined);
const setActive = vi.fn().mockResolvedValue(undefined);
const saveCurrent = vi.fn().mockResolvedValue(4);

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({
    scenarios: [baseline, scenarioA],
    activeScenario: () => baseline,
    duplicate,
    remove,
    setActive,
    saveCurrentAsScenario: saveCurrent,
    rename: vi.fn(),
  }),
}));

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: () => ({
    loans: [{ id: 1, name: 'Auto loan', balance: 18400, rate: 0.059, monthlyPayment: 425 }],
  }),
}));

function makeMilestones(): Map<number, Milestones> {
  const m = new Map<number, Milestones>();
  m.set(1, { debtFreeISO: '2029-06', financialIndependenceISO: '2042-04', netWorth30y: 2_345_000 });
  m.set(2, { debtFreeISO: '2028-02', financialIndependenceISO: '2041-09', netWorth30y: 2_550_000 });
  return m;
}

function setup(opts?: { netWorth30yFmt?: Map<number, string>; basisSuffix?: string }) {
  const onClose = vi.fn();
  const onEditLevers = vi.fn();
  render(
    <MemoryRouter>
      <ManageScenariosModal
        milestones={makeMilestones()}
        netWorth30yFmt={opts?.netWorth30yFmt ?? new Map([[1, '$2,345,000'], [2, '$2,550,000']])}
        basisSuffix={opts?.basisSuffix ?? '(future $)'}
        onClose={onClose}
        onEditLevers={onEditLevers}
      />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose, onEditLevers };
}

describe('ManageScenariosModal', () => {
  beforeEach(() => {
    duplicate.mockClear();
    remove.mockClear();
    setActive.mockClear();
    saveCurrent.mockClear();
  });

  it('renders a table row per scenario with the Levers Applied summary', () => {
    setup();
    expect(screen.getByText('Baseline')).toBeInTheDocument();
    expect(screen.getByText('Aggressive payoff')).toBeInTheDocument();
    expect(screen.getByText('+$300/mo on Auto loan (Always)')).toBeInTheDocument();
    expect(screen.getByText('No overrides')).toBeInTheDocument();
  });

  it('shows debt-free, FI, and 30y NW columns per row — every cell carries the Future $ mark (WI-7)', () => {
    setup();
    expect(screen.getByText('2029-06')).toBeInTheDocument();
    expect(screen.getByText('2042-04')).toBeInTheDocument();
    const cells = screen.getAllByTestId('manage-nw30y').map((c) => c.textContent);
    expect(cells).toEqual(['$2,345,000 (future $)', '$2,550,000 (future $)']);
    expect(screen.getByText('30y NW')).toBeInTheDocument(); // plain header — the mark lives on the cells (D-W51-7)
  });

  it("30y NW renders the bundle's strings verbatim — a today's-$ bundle never shows the nominal figure (T17, structurally)", () => {
    setup({ netWorth30yFmt: new Map([[1, '$1,117,962'], [2, '$1,215,694']]), basisSuffix: "(today's $)" });
    const cells = screen.getAllByTestId('manage-nw30y').map((c) => c.textContent);
    expect(cells).toEqual(["$1,117,962 (today's $)", "$1,215,694 (today's $)"]);
    expect(screen.queryByText(/\$2,345,000/)).not.toBeInTheDocument();
  });

  it('a scenario without a 30y figure prints an em-dash, never a fake $0', () => {
    setup({ netWorth30yFmt: new Map([[1, '$2,345,000']]) });
    expect(screen.getAllByTestId('manage-nw30y').map((c) => c.textContent)).toEqual(['$2,345,000 (future $)', '—']);
  });

  it('Duplicate calls scenarios-store.duplicate(id)', async () => {
    const { user } = setup();
    const row = screen.getByText('Aggressive payoff').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /duplicate/i }));
    expect(duplicate).toHaveBeenCalledWith(2);
  });

  it('Delete on the baseline row is disabled', () => {
    setup();
    const row = screen.getByText('Baseline').closest('tr')!;
    expect(within(row).getByRole('button', { name: /delete/i })).toBeDisabled();
  });

  it('Delete on a user-scenario row calls scenarios-store.remove(id)', async () => {
    const { user } = setup();
    const row = screen.getByText('Aggressive payoff').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /delete/i }));
    expect(remove).toHaveBeenCalledWith(2);
  });

  it('Edit Levers calls onEditLevers(id) and closes the modal', async () => {
    const { user, onEditLevers, onClose } = setup();
    const row = screen.getByText('Aggressive payoff').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /edit levers/i }));
    expect(onEditLevers).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalled();
  });
});
