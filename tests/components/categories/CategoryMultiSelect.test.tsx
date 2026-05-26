import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CategoryMultiSelect } from '@/components/categories/CategoryMultiSelect';
import type { Category } from '@/types/schema';
import { CategoryType } from '@/types/enums';

const baseCat = (overrides: Partial<Category>): Category => ({
  id: 0,
  name: '',
  parentCategoryId: null,
  color: null,
  icon: null,
  type: CategoryType.NEED,
  isCapital: false,
  systemManaged: false,
  monthlyBudget: null,
  ...overrides,
});

const CATEGORIES: Category[] = [
  baseCat({ id: 1, name: 'Home' }),
  baseCat({ id: 10, name: 'Utilities', parentCategoryId: 1 }),
  baseCat({ id: 11, name: 'Internet', parentCategoryId: 1 }),
  baseCat({ id: 2, name: 'Vehicles' }),
  baseCat({ id: 17, name: 'Gas/Fuel', parentCategoryId: 2 }),
];

function rendered(opts: { selected?: number[]; onChange?: (ids: number[]) => void } = {}) {
  const onChange = opts.onChange ?? vi.fn();
  render(
    <MemoryRouter>
      <CategoryMultiSelect
        categories={CATEGORIES}
        selected={opts.selected ?? []}
        onChange={onChange}
        label="Utilities categories"
      />
    </MemoryRouter>,
  );
  return { onChange };
}

describe('CategoryMultiSelect', () => {
  it('renders an Entities-style button with (N/M)', () => {
    rendered({ selected: [10, 11] });
    // M = count of LEAF categories (those with parentCategoryId !== null) = 3 (10, 11, 17)
    expect(
      screen.getByRole('button', { name: /utilities categories \(2\/3\)/i }),
    ).toBeInTheDocument();
  });

  it('opens a popover with parent-grouped leaf categories', async () => {
    const user = userEvent.setup();
    rendered();
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Parent headers visible:
    expect(screen.getByText(/^Home$/)).toBeInTheDocument();
    expect(screen.getByText(/^Vehicles$/)).toBeInTheDocument();
    // Leaf checkboxes visible (use exact-name regex to avoid the dialog
    // aria-label "Utilities categories picker" which also matches /Utilities/):
    expect(screen.getByLabelText(/^Utilities$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Internet$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Gas\/Fuel$/)).toBeInTheDocument();
  });

  it('toggling a checkbox calls onChange with the updated id list', async () => {
    const user = userEvent.setup();
    const { onChange } = rendered({ selected: [10] });
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    await user.click(screen.getByLabelText(/Internet/));
    expect(onChange).toHaveBeenLastCalledWith([10, 11]);
  });

  it('unchecking a checkbox removes the id', async () => {
    const user = userEvent.setup();
    const { onChange } = rendered({ selected: [10, 11] });
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    await user.click(screen.getByLabelText(/Internet/));
    expect(onChange).toHaveBeenLastCalledWith([10]);
  });

  it('Show all selects every leaf', async () => {
    const user = userEvent.setup();
    const { onChange } = rendered();
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    await user.click(screen.getByRole('button', { name: /^show all$/i }));
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([10, 11, 17]));
  });

  it('Hide all clears the selection', async () => {
    const user = userEvent.setup();
    const { onChange } = rendered({ selected: [10, 11, 17] });
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    await user.click(screen.getByRole('button', { name: /^hide all$/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('search filter narrows visible leaves', async () => {
    const user = userEvent.setup();
    rendered();
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    await user.type(screen.getByLabelText(/search/i), 'gas');
    expect(screen.getByLabelText(/Gas\/Fuel/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Utilities$/)).toBeNull();
  });

  it('closes the popover on backdrop click', async () => {
    const user = userEvent.setup();
    rendered();
    await user.click(screen.getByRole('button', { name: /utilities categories/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('category-picker-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the button with helper text when categories is empty', () => {
    render(
      <MemoryRouter>
        <CategoryMultiSelect categories={[]} selected={[]} onChange={() => {}} label="Empty" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /no categories/i })).toBeDisabled();
  });

  it('applies an optional filterFn to limit the picker list', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CategoryMultiSelect
          categories={CATEGORIES}
          selected={[]}
          onChange={() => {}}
          label="Filtered"
          filterFn={(c) => c.name !== 'Internet'}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /filtered/i }));
    expect(screen.queryByLabelText(/Internet/)).toBeNull();
    expect(screen.getByLabelText(/Utilities/)).toBeInTheDocument();
  });
});
