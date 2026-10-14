import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useEffect, useState } from 'react';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  EntryDialogContent,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

const ASK = 'Discard unsaved entries?';

/** The entry dialog, also while the question hides it from assistive tech
 *  (the open question marks everything behind it aria-hidden). */
function entryDialog(): Element | null {
  return screen.queryByText('Add a thing')?.closest('[role="dialog"]') ?? null;
}

describe('EntryDialogContent — Escape asks once something is entered (CR-O-3)', () => {
  it('Escape closes a pristine dialog at once, as before', async () => {
    const { user, onOpenChange } = await openHarness();
    await user.keyboard('{Escape}');
    expect(entryDialog()).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('once a value is typed, Escape asks; Stay keeps every value and puts focus back on the field', async () => {
    const { user, onOpenChange } = await openHarness();
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    await user.type(name, 'Pat Rivera');
    await user.keyboard('{Escape}');
    const ask = await screen.findByRole('dialog', { name: ASK });
    expect(ask).toHaveTextContent(
      "Anything entered here that hasn't been saved is discarded. Saved entries are not affected.",
    );
    expect(entryDialog()).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    // The question opens on Stay, so Enter keeps everything too.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay' })));
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Add a thing' })).toBeInTheDocument();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pat Rivera');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('Escape on the question is Stay: the select keeps its pick and its focus', async () => {
    const { user, onOpenChange } = await openHarness();
    const type = screen.getByLabelText('Type') as HTMLSelectElement;
    await user.selectOptions(type, 'b');
    type.focus();
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Add a thing' })).toBeInTheDocument();
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('b');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Type')));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("a pointer-down on the question's overlay is Stay too", async () => {
    const { user, onOpenChange } = await openHarness();
    await user.type(screen.getByLabelText('Name'), 'Pat Rivera');
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await settleRadixListeners();
    const overlays = document.querySelectorAll('[data-state="open"].fixed.inset-0');
    expect(overlays).toHaveLength(2);
    fireEvent.pointerDown(overlays[1]);
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Add a thing' })).toBeInTheDocument();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pat Rivera');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('Discard entries closes it, the same way as the X', async () => {
    const { user, onOpenChange } = await openHarness();
    await user.type(screen.getByLabelText('Name'), 'Pat Rivera');
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.click(screen.getByRole('button', { name: 'Discard entries' }));
    expect(entryDialog()).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('the X closes at once, entries or not: it is an explicit discard', async () => {
    const { user, onOpenChange } = await openHarness();
    await user.type(screen.getByLabelText('Name'), 'Pat Rivera');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(entryDialog()).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/** A form with a Radix Select (HouseholdForm's Filing status is the one in an
 *  onboarding dialog). `hydrateTo` sets the value from an effect, as RHF's
 *  `values` reset does after mount. Inside a <form>, Radix renders its hidden
 *  select, which fires a change event on every value change. */
function SelectHarness({ hydrateTo }: { hydrateTo?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add manually
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <EntryDialogContent>
          <DialogTitle>Add a thing</DialogTitle>
          <DialogDescription>Entry harness.</DialogDescription>
          <SelectForm hydrateTo={hydrateTo} />
        </EntryDialogContent>
      </Dialog>
    </>
  );
}

function SelectForm({ hydrateTo }: { hydrateTo?: string }) {
  const [value, setValue] = useState('a');
  useEffect(() => {
    if (hydrateTo) setValue(hydrateTo);
  }, [hydrateTo]);
  return (
    <form>
      <Select value={value} onValueChange={(v) => v !== '' && setValue(v)}>
        <SelectTrigger aria-label="Filing status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>
    </form>
  );
}

describe('EntryDialogContent — what counts as entered (CR-O-3)', () => {
  it('a Radix Select pick counts, though it reaches the dialog only as a change event', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    await screen.findByRole('dialog', { name: 'Add a thing' });
    await user.click(screen.getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Beta' }));
    expect(screen.getByRole('combobox', { name: 'Filing status' })).toHaveTextContent('Beta');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(entryDialog()).not.toBeNull();
  });

  it('a value the form sets itself (the Radix Select hydration echo) does not count', async () => {
    const user = userEvent.setup();
    render(<SelectHarness hydrateTo="b" />);
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    await screen.findByRole('dialog', { name: 'Add a thing' });
    expect(screen.getByRole('combobox', { name: 'Filing status' })).toHaveTextContent('Beta');
    await user.keyboard('{Escape}');
    expect(entryDialog()).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });

  it('an entry made with no key or pointer press (autofill, dictation) still counts', async () => {
    const { user } = await openHarness();
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Pat Rivera' } });
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pat Rivera');
  });
});

/** The parent owns the field's value, so every keystroke re-renders the
 *  component that renders EntryDialogContent (as a gate step re-renders on
 *  a store update while its dialog is open). */
function ControlledHarness() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add manually
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <EntryDialogContent>
          <DialogTitle>Add a thing</DialogTitle>
          <DialogDescription>Entry harness.</DialogDescription>
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </EntryDialogContent>
      </Dialog>
    </>
  );
}

describe('EntryDialogContent — every open starts pristine (CR-O-3)', () => {
  it('after Discard entries, the reopened dialog is empty and Escape closes it at once', async () => {
    const { user } = await openHarness();
    await user.type(screen.getByLabelText('Name'), 'Pat Rivera');
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.click(screen.getByRole('button', { name: 'Discard entries' }));
    expect(entryDialog()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    await screen.findByRole('dialog', { name: 'Add a thing' });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    await user.keyboard('{Escape}');
    expect(entryDialog()).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });

  it("a press in an earlier open never lets the next open's hydration echo count", async () => {
    const user = userEvent.setup();
    render(<SelectHarness hydrateTo="b" />);
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    await screen.findByRole('dialog', { name: 'Add a thing' });
    await user.click(screen.getByText('Entry harness.'));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(entryDialog()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    await screen.findByRole('dialog', { name: 'Add a thing' });
    await user.keyboard('{Escape}');
    expect(entryDialog()).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });

  it('a re-render while it is open keeps what was entered marked (StrictMode, as src/main.tsx)', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ControlledHarness />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    await screen.findByRole('dialog', { name: 'Add a thing' });
    await user.type(screen.getByLabelText('Name'), 'Pat Rivera');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pat Rivera');
  });
});
