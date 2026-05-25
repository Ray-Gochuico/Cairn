import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetCategoryPicker from '@/components/budget/BudgetCategoryPicker';
import type { ParentGroup } from '@/lib/budget-analysis';

type Option = { id: number; name: string };

const opts: Option[] = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Gas/Fuel' },
  { id: 3, name: 'Coffee' },
];

// Single-group helper for the original flat-list tests — wraps everything in
// one 'General' group. The picker should render every option regardless.
const asFlat = (xs: Option[]): ParentGroup[] => [
  { parentId: null, parentName: 'General', options: xs },
];

describe('BudgetCategoryPicker', () => {
  it('renders nothing of substance when there are no untracked categories', () => {
    render(<BudgetCategoryPicker groups={[]} onConfirm={() => {}} />);
    // No trigger button should be visible when there's nothing to add.
    expect(screen.queryByRole('button', { name: /add categor/i })).not.toBeInTheDocument();
  });

  it('shows a trigger button and opens a picker listing each untracked category', async () => {
    const user = userEvent.setup();
    render(<BudgetCategoryPicker groups={asFlat(opts)} onConfirm={() => {}} />);

    const trigger = screen.getByRole('button', { name: /add categor/i });
    await user.click(trigger);

    // Every untracked category appears as a checkbox row.
    expect(screen.getByRole('checkbox', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Gas/Fuel' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Coffee' })).toBeInTheDocument();
  });

  it('calls onConfirm with all checked ids when the apply button is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker groups={asFlat(opts)} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /add categor/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Groceries' }));
    await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Coffee' }));

    // Apply button now reads "Add 3 categories".
    const apply = screen.getByRole('button', { name: /add 3 categor/i });
    await user.click(apply);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Order is the order they were selected in (here matches list order).
    const arg = (onConfirm.mock.calls[0]?.[0] ?? []) as number[];
    expect(arg.sort()).toEqual([1, 2, 3]);
  });

  it('apply button reflects the selected count and is disabled with no selection', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker groups={asFlat(opts)} onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: /add categor/i }));

    // With nothing selected the apply button reads "Add 0 categories" and is disabled.
    const apply = screen.getByRole('button', { name: /add 0 categor/i });
    expect(apply).toBeDisabled();

    // Check one and the label updates to "Add 1 category", enabled.
    await user.click(screen.getByRole('checkbox', { name: 'Coffee' }));
    expect(screen.getByRole('button', { name: /add 1 categor/i })).toBeEnabled();
  });

  it('opening, checking, then closing without clicking Apply does not call onConfirm and clears selection', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker groups={asFlat(opts)} onConfirm={onConfirm} />);

    // Open, check Groceries, close via the close button.
    await user.click(screen.getByRole('button', { name: /add categor/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Groceries' }));

    // Close. The Dialog primitive renders a "Close" button (sr-only label).
    const closeBtn = screen.getByRole('button', { name: /^close$/i });
    await user.click(closeBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Re-open and confirm the previously checked box is unchecked (state cleared).
    await user.click(screen.getByRole('button', { name: /add categor/i }));
    const cb = screen.getByRole('checkbox', { name: 'Groceries' }) as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('unchecking a category removes it from the selection count', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker groups={asFlat(opts)} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /add categor/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Groceries' }));
    await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));
    expect(screen.getByRole('button', { name: /add 2 categor/i })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Groceries' })); // uncheck
    expect(screen.getByRole('button', { name: /add 1 categor/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add 1 categor/i }));
    expect(onConfirm).toHaveBeenCalledWith([2]);
  });

  describe('grouped rendering by parent category', () => {
    const groups: ParentGroup[] = [
      {
        parentId: 1,
        parentName: 'Home',
        options: [
          { id: 11, name: 'Mortgage' },
          { id: 12, name: 'Utilities' },
        ],
      },
      {
        parentId: 2,
        parentName: 'Vehicles',
        options: [
          { id: 21, name: 'Gas/Fuel' },
          { id: 22, name: 'Maintenance' },
        ],
      },
      {
        parentId: null,
        parentName: 'General',
        options: [{ id: 33, name: 'Groceries' }],
      },
    ];

    // Sentinel test for grouped rendering — must catch the change to grouping.
    // Verified load-bearing via revert-fail-restore-pass.
    it('renders parent name headers and groups leaf checkboxes under them', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Each parent name appears as a heading-style label (role distinct from checkbox).
      const homeHeader = screen.getByText('Home');
      const vehiclesHeader = screen.getByText('Vehicles');
      const generalHeader = screen.getByText('General');
      expect(homeHeader).toBeInTheDocument();
      expect(vehiclesHeader).toBeInTheDocument();
      expect(generalHeader).toBeInTheDocument();

      // Each group is rendered in a region/group container that contains its
      // own checkboxes. We look up by group label and assert checkbox membership.
      const homeGroup = screen.getByRole('group', { name: 'Home' });
      expect(within(homeGroup).getByRole('checkbox', { name: 'Mortgage' })).toBeInTheDocument();
      expect(within(homeGroup).getByRole('checkbox', { name: 'Utilities' })).toBeInTheDocument();
      expect(within(homeGroup).queryByRole('checkbox', { name: 'Gas/Fuel' })).not.toBeInTheDocument();

      const vehiclesGroup = screen.getByRole('group', { name: 'Vehicles' });
      expect(within(vehiclesGroup).getByRole('checkbox', { name: 'Gas/Fuel' })).toBeInTheDocument();
      expect(within(vehiclesGroup).getByRole('checkbox', { name: 'Maintenance' })).toBeInTheDocument();
      expect(within(vehiclesGroup).queryByRole('checkbox', { name: 'Mortgage' })).not.toBeInTheDocument();

      const generalGroup = screen.getByRole('group', { name: 'General' });
      expect(within(generalGroup).getByRole('checkbox', { name: 'Groceries' })).toBeInTheDocument();
    });

    it('shows a "(N/M selected)" indicator per group as leaves are checked', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Pre-selection — Home group reports 0/2.
      const homeGroup = screen.getByRole('group', { name: 'Home' });
      expect(within(homeGroup).getByText(/0\s*\/\s*2/)).toBeInTheDocument();

      // Check one Home leaf → 1/2.
      await user.click(within(homeGroup).getByRole('checkbox', { name: 'Mortgage' }));
      expect(within(homeGroup).getByText(/1\s*\/\s*2/)).toBeInTheDocument();

      // Check the other Home leaf → 2/2.
      await user.click(within(homeGroup).getByRole('checkbox', { name: 'Utilities' }));
      expect(within(homeGroup).getByText(/2\s*\/\s*2/)).toBeInTheDocument();

      // Vehicles group is untouched and still reports 0/2.
      const vehiclesGroup = screen.getByRole('group', { name: 'Vehicles' });
      expect(within(vehiclesGroup).getByText(/0\s*\/\s*2/)).toBeInTheDocument();
    });

    it('confirming with selections from multiple groups returns every selected id', async () => {
      const onConfirm = vi.fn();
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={onConfirm} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      const homeGroup = screen.getByRole('group', { name: 'Home' });
      await user.click(within(homeGroup).getByRole('checkbox', { name: 'Mortgage' }));

      const vehiclesGroup = screen.getByRole('group', { name: 'Vehicles' });
      await user.click(within(vehiclesGroup).getByRole('checkbox', { name: 'Gas/Fuel' }));

      const generalGroup = screen.getByRole('group', { name: 'General' });
      await user.click(within(generalGroup).getByRole('checkbox', { name: 'Groceries' }));

      const apply = screen.getByRole('button', { name: /add 3 categor/i });
      await user.click(apply);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const arg = (onConfirm.mock.calls[0]?.[0] ?? []) as number[];
      expect(arg.sort((a, b) => a - b)).toEqual([11, 21, 33]);
    });
  });
});
