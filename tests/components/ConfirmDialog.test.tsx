import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';

describe('ConfirmDialog (controlled component)', () => {
  it('renders the title and description when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete this account?"
        description="This also deletes its snapshots, holdings, and contributions."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Delete this account?')).toBeInTheDocument();
    expect(
      screen.getByText(/this also deletes its snapshots/i),
    ).toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete this account?"
        description="desc"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText('Delete this account?')).not.toBeInTheDocument();
  });

  it('calls onConfirm (not onCancel) when the destructive button is clicked', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Delete this account?"
        description="desc"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel (not onConfirm) when Cancel is clicked', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Delete this account?"
        description="desc"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a destructive-styled confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="Delete this account?"
        description="desc"
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    // The shared Button's destructive variant maps to the bg-destructive class.
    expect(confirmBtn.className).toMatch(/destructive/);
  });
});

describe('useConfirm hook', () => {
  // A tiny harness component that exposes confirm() behind a button and
  // records the resolved boolean so the test can assert on it.
  function Harness({ onResult }: { onResult: (v: boolean) => void }) {
    const { confirm, dialog } = useConfirm();
    return (
      <div>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete this item?',
              description: 'This cannot be undone.',
              confirmLabel: 'Delete',
            });
            onResult(ok);
          }}
        >
          trigger
        </button>
        {dialog}
      </div>
    );
  }

  it('resolves true when the user confirms', async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<Harness onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    expect(await screen.findByText('Delete this item?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('resolves false when the user cancels', async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<Harness onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    expect(await screen.findByText('Delete this item?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('closes the dialog after a choice is made', async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<Harness onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByText('Delete this item?')).not.toBeInTheDocument(),
    );
  });

  it('does not invoke a stale resolver across two sequential confirms', async () => {
    // Guards against the classic bug where the promise resolver from the
    // first confirm() leaks into the second invocation.
    const results: boolean[] = [];
    function Seq() {
      const { confirm, dialog } = useConfirm();
      const [n, setN] = useState(0);
      return (
        <div>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: `Confirm ${n}`,
                description: 'd',
                confirmLabel: 'Confirm',
              });
              results.push(ok);
              setN((x) => x + 1);
            }}
          >
            go
          </button>
          {dialog}
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Seq />);

    await user.click(screen.getByRole('button', { name: 'go' }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(results).toEqual([false]));

    await user.click(screen.getByRole('button', { name: 'go' }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(results).toEqual([false, true]));
  });
});
