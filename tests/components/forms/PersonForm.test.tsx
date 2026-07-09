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

    // W10 M44: the summary names the humanized field, not the raw RHF key.
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/fix this field before saving/i);
    expect(banner).toHaveTextContent(/Date of birth/);
    expect(banner.querySelector('.font-mono')).toBeNull();
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

describe('PersonForm — W10 M44 error honesty', () => {
  it('surfaces a rejected save as a role=alert banner instead of swallowing it (W10 M44)', async () => {
    const user = userEvent.setup();
    render(
      <PersonForm
        initial={{ ...DEFAULT_PERSON, name: 'Alice', dateOfBirth: '1990-01-01' }}
        onSubmit={vi.fn().mockRejectedValue(new Error('DB locked'))}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save.*DB locked/i);
  });

  it('renders a humanized inline error + aria-invalid on the empty name field, not raw Zod', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PersonForm initial={{ ...DEFAULT_PERSON, name: '' }} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const name = screen.getByLabelText(/^name$/i);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Required');
    expect(screen.queryByText(/expected string/i)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
