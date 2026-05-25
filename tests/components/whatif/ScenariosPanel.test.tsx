import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScenariosPanel } from '@/components/whatif/ScenariosPanel';
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
const userScenario: Scenario = {
  id: 2,
  name: 'Aggressive payoff',
  isBaseline: false,
  color: '#f59e0b',
  lineStyle: 'dashed',
  visible: true,
  isActive: false,
  sortOrder: 1,
  leverPayload: emptyLeverPayload(),
  createdAt: '2026-05-24T00:00:00Z',
  updatedAt: '2026-05-24T00:00:00Z',
};

const toggleVisibility = vi.fn().mockResolvedValue(undefined);
const setActive = vi.fn().mockResolvedValue(undefined);
const duplicate = vi.fn().mockResolvedValue(3);
const remove = vi.fn().mockResolvedValue(undefined);
const rename = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({
    scenarios: [baseline, userScenario],
    activeScenario: () => baseline,
    visibleScenarioIds: () => [1, 2],
    toggleVisibility,
    setActive,
    duplicate,
    remove,
    rename,
    saveCurrentAsScenario: vi.fn().mockResolvedValue(99),
  }),
}));

function makeMilestones(): Map<number, Milestones> {
  const m = new Map<number, Milestones>();
  m.set(1, { debtFreeISO: '2029-06', financialIndependenceISO: '2042-04' });
  m.set(2, { debtFreeISO: '2028-02', financialIndependenceISO: '2041-09' });
  return m;
}

function setup() {
  const onOpenManage = vi.fn();
  const onEditLevers = vi.fn();
  render(
    <MemoryRouter>
      <ScenariosPanel
        milestones={makeMilestones()}
        onOpenManage={onOpenManage}
        onEditLevers={onEditLevers}
      />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onOpenManage, onEditLevers };
}

describe('ScenariosPanel', () => {
  beforeEach(() => {
    toggleVisibility.mockClear();
    setActive.mockClear();
    duplicate.mockClear();
    remove.mockClear();
    rename.mockClear();
  });

  it('renders one row per scenario with name + active tag on the active row', () => {
    setup();
    expect(screen.getByText('Baseline')).toBeInTheDocument();
    expect(screen.getByText('Aggressive payoff')).toBeInTheDocument();
    expect(screen.getByText(/\bactive\b/i)).toBeInTheDocument();
  });

  it('renders a key milestone summary per row', () => {
    setup();
    expect(screen.getAllByText(/debt-free/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\bfi\b/i).length).toBeGreaterThan(0);
  });

  it('clicking a visibility checkbox calls toggleVisibility(id)', async () => {
    const { user } = setup();
    const row = screen.getByText('Aggressive payoff').closest('[data-row-id]')!;
    const checkbox = within(row as HTMLElement).getByRole('checkbox');
    await user.click(checkbox);
    expect(toggleVisibility).toHaveBeenCalledWith(2);
  });

  it('clicking the row name calls setActive(id)', async () => {
    const { user } = setup();
    await user.click(screen.getByText('Aggressive payoff'));
    expect(setActive).toHaveBeenCalledWith(2);
  });

  it('"+ Save current" button opens SaveCurrentDialog', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /save current/i }));
    expect(await screen.findByText('Save current as scenario')).toBeInTheDocument();
  });

  it('"Manage…" button calls onOpenManage', async () => {
    const { user, onOpenManage } = setup();
    await user.click(screen.getByRole('button', { name: /manage/i }));
    expect(onOpenManage).toHaveBeenCalled();
  });

  it('Delete in the ⋯ menu is disabled on the baseline row', async () => {
    const { user } = setup();
    const baselineRow = screen.getByText('Baseline').closest('[data-row-id]')!;
    await user.click(within(baselineRow as HTMLElement).getByLabelText(/more actions/i));
    const deleteItem = await screen.findByRole('menuitem', { name: /delete/i });
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('Duplicate in the ⋯ menu of a user scenario calls duplicate(id)', async () => {
    const { user } = setup();
    const row = screen.getByText('Aggressive payoff').closest('[data-row-id]')!;
    await user.click(within(row as HTMLElement).getByLabelText(/more actions/i));
    await user.click(await screen.findByRole('menuitem', { name: /duplicate/i }));
    expect(duplicate).toHaveBeenCalledWith(2);
  });

  it('Edit Levers in the ⋯ menu calls onEditLevers(id)', async () => {
    const { user, onEditLevers } = setup();
    const row = screen.getByText('Aggressive payoff').closest('[data-row-id]')!;
    await user.click(within(row as HTMLElement).getByLabelText(/more actions/i));
    await user.click(await screen.findByRole('menuitem', { name: /edit levers/i }));
    expect(onEditLevers).toHaveBeenCalledWith(2);
  });
});
