import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AddCategoryDialog from '@/components/budget/AddCategoryDialog';
import type { Category } from '@/types/schema';

// Two top-level budgetable parents. The dialog itself does not filter — its
// caller (BudgetCategoryPicker) is expected to pass an already-filtered list.
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

const renderDialog = (props: Partial<React.ComponentProps<typeof AddCategoryDialog>> = {}) =>
  render(
    <MemoryRouter>
      <AddCategoryDialog
        open
        parents={props.parents ?? parents}
        onSave={props.onSave ?? (() => {})}
        onClose={props.onClose ?? (() => {})}
      />
    </MemoryRouter>,
  );

describe('AddCategoryDialog', () => {
  it('renders all three fields when open', () => {
    renderDialog();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/parent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^need$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^want$/i })).toBeInTheDocument();
  });

  it('Save is disabled until name + parent populated', async () => {
    const user = userEvent.setup();
    renderDialog();
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText(/name/i), 'Bakery');
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/parent/i), '1');
    expect(save).not.toBeDisabled();
  });

  it('Save calls onSave with the right payload (defaults type to NEED)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });
    await user.type(screen.getByLabelText(/name/i), 'Bakery');
    await user.selectOptions(screen.getByLabelText(/parent/i), '1');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Bakery',
      parentCategoryId: 1,
      type: 'NEED',
      color: null,
      icon: null,
      isCapital: false,
      monthlyBudget: null,
    });
  });

  it('type toggle switches default NEED to WANT', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });
    await user.type(screen.getByLabelText(/name/i), 'Bakery');
    await user.selectOptions(screen.getByLabelText(/parent/i), '1');
    await user.click(screen.getByRole('button', { name: /^want$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'WANT' }));
  });

  it('Cancel calls onClose without onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSave, onClose });
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('with no parents, shows hint and Save stays disabled', () => {
    renderDialog({ parents: [] });
    expect(screen.getByText(/Add a parent category in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });
});
