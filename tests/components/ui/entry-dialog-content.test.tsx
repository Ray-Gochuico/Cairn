import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  EntryDialogContent,
} from '@/components/ui/dialog';

/**
 * v1.8.0 O2 (RC2, CR-O-3): EntryDialogContent, the opt-in content of an
 * entry dialog. Before it, every onboarding "Add …" dialog closed on an
 * overlay pointer-down or on Escape and unmounted its form, so whatever the
 * user had typed or picked was gone on reopen.
 */

/** Radix adds its document pointerdown listener on a setTimeout(0). */
async function settleRadixListeners() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function overlay(): Element {
  const el = document.querySelector('[data-state="open"].fixed.inset-0');
  if (!el) throw new Error('no open overlay');
  return el;
}

function Harness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add manually
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) setOpen(false);
        }}
      >
        <EntryDialogContent>
          <DialogTitle>Add a thing</DialogTitle>
          <DialogDescription>Entry harness.</DialogDescription>
          <input aria-label="Name" />
          <select aria-label="Type" defaultValue="a">
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </EntryDialogContent>
      </Dialog>
    </>
  );
}

async function openHarness() {
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onOpenChange={onOpenChange} />);
  await user.click(screen.getByRole('button', { name: 'Add manually' }));
  await screen.findByRole('dialog', { name: 'Add a thing' });
  await settleRadixListeners();
  return { user, onOpenChange };
}

describe('EntryDialogContent — outside never dismisses (CR-O-3)', () => {
  it('a pointer-down on the overlay keeps a pristine dialog open', async () => {
    const { onOpenChange } = await openHarness();
    fireEvent.pointerDown(overlay());
    expect(screen.getByRole('dialog', { name: 'Add a thing' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a pointer-down on the overlay keeps the dialog and every value typed or picked in it', async () => {
    const { user, onOpenChange } = await openHarness();
    await user.type(screen.getByLabelText('Name'), 'Pat Rivera');
    await user.selectOptions(screen.getByLabelText('Type'), 'b');
    await settleRadixListeners();
    fireEvent.pointerDown(overlay());
    expect(screen.getByRole('dialog', { name: 'Add a thing' })).toBeInTheDocument();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pat Rivera');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('b');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a pointer-down elsewhere on the page keeps it open', async () => {
    const { onOpenChange } = await openHarness();
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog', { name: 'Add a thing' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
