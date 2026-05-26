import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BudgetCategoryPicker from '@/components/budget/BudgetCategoryPicker';
import type { ParentGroup } from '@/lib/budget-analysis';
import type { Category } from '@/types/schema';

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

  describe('Add category trigger', () => {
    // Two top-level budgetable parents. The picker filters its caller-supplied
    // parents list before passing it to AddCategoryDialog (top-level NEED/WANT/
    // SAVINGS only).
    const parents: Category[] = [
      {
        id: 1,
        name: 'Home',
        parentCategoryId: null,
        type: 'NEED',
        color: null,
        icon: null,
        isCapital: false,
        monthlyBudget: null,
        systemManaged: false,
      } as Category,
      {
        id: 2,
        name: 'Vehicles',
        parentCategoryId: null,
        type: 'NEED',
        color: null,
        icon: null,
        isCapital: false,
        monthlyBudget: null,
        systemManaged: false,
      } as Category,
    ];

    const groups: ParentGroup[] = [
      { parentId: null, parentName: 'General', options: [{ id: 33, name: 'Groceries' }] },
    ];

    it('renders the "+ Add category" button at the bottom of the picker dialog', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={groups}
            onConfirm={() => {}}
            parents={parents}
            onCreateCategory={() => {}}
          />
        </MemoryRouter>,
      );
      // Open the picker dialog first.
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      // The "+ Add category" trigger appears inside the dialog.
      expect(screen.getByRole('button', { name: /\+ add category$/i })).toBeInTheDocument();
    });

    it('clicking "+ Add category" opens AddCategoryDialog', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={groups}
            onConfirm={() => {}}
            parents={parents}
            onCreateCategory={() => {}}
          />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.click(screen.getByRole('button', { name: /\+ add category$/i }));
      // The AddCategoryDialog renders its own DialogTitle "Add category"
      // (distinct from the picker's "Add categories to track" title).
      expect(screen.getByRole('heading', { name: /^add category$/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    });

    it('Save in AddCategoryDialog calls onCreateCategory with the payload', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn();
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={groups}
            onConfirm={() => {}}
            parents={parents}
            onCreateCategory={onCreate}
          />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.click(screen.getByRole('button', { name: /\+ add category$/i }));
      await user.type(screen.getByLabelText(/name/i), 'Bakery');
      await user.selectOptions(screen.getByLabelText(/parent/i), '1');
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bakery', parentCategoryId: 1, type: 'NEED' }),
      );
    });

    it('does not render the "+ Add category" trigger when onCreateCategory is not provided', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <BudgetCategoryPicker groups={groups} onConfirm={() => {}} />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      // No "+ Add category" trigger (singular) when the create callback is absent.
      expect(screen.queryByRole('button', { name: /\+ add category$/i })).not.toBeInTheDocument();
    });

    it('filters parents to top-level NEED/WANT/SAVINGS only', async () => {
      const user = userEvent.setup();
      // Mixed parents — only the top-level NEED/WANT/SAVINGS should show.
      const mixedParents: Category[] = [
        ...parents,
        // child category (parentCategoryId != null) — should be filtered out
        {
          id: 10,
          name: 'Utilities',
          parentCategoryId: 1,
          type: 'NEED',
          color: null,
          icon: null,
          isCapital: false,
          monthlyBudget: null,
          systemManaged: false,
        } as Category,
        // top-level INCOME — should be filtered out
        {
          id: 99,
          name: 'Salary',
          parentCategoryId: null,
          type: 'INCOME',
          color: null,
          icon: null,
          isCapital: false,
          monthlyBudget: null,
          systemManaged: false,
        } as Category,
      ];
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={groups}
            onConfirm={() => {}}
            parents={mixedParents}
            onCreateCategory={() => {}}
          />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.click(screen.getByRole('button', { name: /\+ add category$/i }));
      const select = screen.getByLabelText(/parent/i) as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toContain('1'); // Home
      expect(optionValues).toContain('2'); // Vehicles
      expect(optionValues).not.toContain('10'); // Utilities (child)
      expect(optionValues).not.toContain('99'); // Salary (INCOME)
    });
  });

  // ─── Task #12 — Always-reachable "+ Add category" trigger ────────────────
  // When every category is tracked (groups is empty) the picker used to bail
  // out and render nothing, leaving the user with no way to create new leaves.
  // With `onCreateCategory` wired, the trigger now renders unconditionally
  // and the empty picker shows a friendly "all tracked" empty state with the
  // "+ Add category" affordance still visible.
  describe('always-reachable "+ Add category"', () => {
    const parents: Category[] = [
      {
        id: 1,
        name: 'Home',
        parentCategoryId: null,
        type: 'NEED',
        color: null,
        icon: null,
        isCapital: false,
        monthlyBudget: null,
        systemManaged: false,
      } as Category,
    ];

    it('renders the picker trigger even when there are zero untracked categories', () => {
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={[]}
            onConfirm={() => {}}
            parents={parents}
            onCreateCategory={() => {}}
          />
        </MemoryRouter>,
      );
      // With onCreateCategory wired the trigger must render even when there's
      // nothing pickable — otherwise the user is locked out of adding new leaves.
      expect(screen.getByRole('button', { name: /add categor/i })).toBeInTheDocument();
    });

    it('shows the "all tracked" empty state inside the picker when no untracked rows exist', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={[]}
            onConfirm={() => {}}
            parents={parents}
            onCreateCategory={() => {}}
          />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      // Friendly empty-state copy in the dialog body.
      expect(
        screen.getByText(/all categories are tracked/i),
      ).toBeInTheDocument();
      // Apply button must be hidden when there's nothing to apply.
      expect(
        screen.queryByRole('button', { name: /add 0 categor/i }),
      ).not.toBeInTheDocument();
    });

    it('the "+ Add category" entry still works from the zero-untracked empty picker', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <BudgetCategoryPicker
            groups={[]}
            onConfirm={() => {}}
            parents={parents}
            onCreateCategory={() => {}}
          />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.click(screen.getByRole('button', { name: /\+ add category$/i }));
      // The AddCategoryDialog's own DialogTitle appears.
      expect(screen.getByRole('heading', { name: /^add category$/i })).toBeInTheDocument();
    });

    it('still renders nothing when groups is empty AND onCreateCategory is undefined (back-compat)', () => {
      render(<BudgetCategoryPicker groups={[]} onConfirm={() => {}} />);
      expect(
        screen.queryByRole('button', { name: /add categor/i }),
      ).not.toBeInTheDocument();
    });
  });

  // ─── Task #14 — Search filter ─────────────────────────────────────────────
  // Inline search input narrows the visible leaves by case-insensitive
  // substring match. Parent headers hide when all their children are filtered
  // out. Selection is purely display — narrowing then widening the filter
  // leaves already-checked leaves with their checked state intact.
  describe('search filter', () => {
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
    ];

    it('filters leaf checkboxes by case-insensitive substring match', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      const search = screen.getByLabelText(/search categories/i);
      await user.type(search, 'gas');

      // Gas/Fuel survives the filter; nothing else does.
      expect(screen.getByRole('checkbox', { name: 'Gas/Fuel' })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Mortgage' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Utilities' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Maintenance' })).not.toBeInTheDocument();
    });

    it('hides parent headers when all their children are filtered out', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Type a query that matches only Vehicles' children — the Home header
      // (and its 0/2 indicator) must disappear from the rendered list.
      await user.type(screen.getByLabelText(/search categories/i), 'fuel');
      expect(screen.queryByRole('group', { name: 'Home' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Vehicles' })).toBeInTheDocument();
    });

    it('case-insensitive — uppercase query matches lowercase names and vice versa', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      await user.type(screen.getByLabelText(/search categories/i), 'MORTG');
      expect(screen.getByRole('checkbox', { name: 'Mortgage' })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Gas/Fuel' })).not.toBeInTheDocument();
    });

    it('selection survives across filter narrow → widen (filter is purely display)', async () => {
      const onConfirm = vi.fn();
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={onConfirm} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Check Mortgage (Home) and Gas/Fuel (Vehicles).
      await user.click(screen.getByRole('checkbox', { name: 'Mortgage' }));
      await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));

      // Narrow the filter to only Gas — Mortgage disappears from the DOM but
      // its in-memory selection must persist.
      const search = screen.getByLabelText(/search categories/i);
      await user.type(search, 'gas');
      expect(screen.queryByRole('checkbox', { name: 'Mortgage' })).not.toBeInTheDocument();
      // Apply button still says "Add 2 categories" because both ids remain selected.
      expect(screen.getByRole('button', { name: /add 2 categor/i })).toBeInTheDocument();

      // Clear the filter — Mortgage reappears AND is still checked.
      await user.clear(search);
      const mortgage = screen.getByRole('checkbox', { name: 'Mortgage' }) as HTMLInputElement;
      expect(mortgage.checked).toBe(true);
      const gas = screen.getByRole('checkbox', { name: 'Gas/Fuel' }) as HTMLInputElement;
      expect(gas.checked).toBe(true);

      // Apply still emits both ids.
      await user.click(screen.getByRole('button', { name: /add 2 categor/i }));
      const arg = (onConfirm.mock.calls[0]?.[0] ?? []) as number[];
      expect(arg.sort((a, b) => a - b)).toEqual([11, 21]);
    });

    it('preserves the (N/M selected) counter for visible groups under filter', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      // Check Mortgage so Home's counter shows 1/2 in the unfiltered view.
      await user.click(screen.getByRole('checkbox', { name: 'Mortgage' }));
      const homeGroup = screen.getByRole('group', { name: 'Home' });
      expect(within(homeGroup).getByText(/1\s*\/\s*2/)).toBeInTheDocument();

      // Filter to "mort" — Home group still rendered with the single visible
      // leaf and the counter must show 1/1 (1 selected of 1 visible).
      await user.type(screen.getByLabelText(/search categories/i), 'mort');
      const homeGroupFiltered = screen.getByRole('group', { name: 'Home' });
      expect(within(homeGroupFiltered).getByText(/1\s*\/\s*1/)).toBeInTheDocument();
    });

    it('shows a "no matches" hint when the query excludes every leaf', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);
      await user.click(screen.getByRole('button', { name: /add categor/i }));

      await user.type(screen.getByLabelText(/search categories/i), 'xyzzy');
      expect(screen.getByText(/no categories match/i)).toBeInTheDocument();
    });

    it('clears the search query when the picker is closed and re-opened', async () => {
      const user = userEvent.setup();
      render(<BudgetCategoryPicker groups={groups} onConfirm={() => {}} />);

      await user.click(screen.getByRole('button', { name: /add categor/i }));
      await user.type(screen.getByLabelText(/search categories/i), 'gas');
      // Close via the Dialog's sr-only close button.
      await user.click(screen.getByRole('button', { name: /^close$/i }));

      // Re-open: search input must be empty again.
      await user.click(screen.getByRole('button', { name: /add categor/i }));
      const search = screen.getByLabelText(/search categories/i) as HTMLInputElement;
      expect(search.value).toBe('');
    });
  });
});
