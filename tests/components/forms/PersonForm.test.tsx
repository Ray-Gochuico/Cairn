import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonForm, { DEFAULT_PERSON } from '@/components/forms/PersonForm';

describe('PersonForm — validation errors', () => {
  it('shows an error banner when submitting with an empty date of birth', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={DEFAULT_PERSON} onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Cause the form to become dirty by typing a name (so submit is enabled
    // historically) — but per the new spec, submit should be enabled regardless.
    await user.type(screen.getByLabelText(/^name$/i), 'Alice');

    await user.click(screen.getByRole('button', { name: /save/i }));

    // RHF surfaces the validation banner with the field name + message.
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/fix these before saving/i);
    expect(banner).toHaveTextContent(/dateOfBirth/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Save enabled even when the form is pristine so retry after fix works', () => {
    render(<PersonForm initial={DEFAULT_PERSON} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it('does not render the error banner before the first submit attempt', () => {
    render(<PersonForm initial={DEFAULT_PERSON} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
