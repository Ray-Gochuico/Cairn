import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditDrawer } from '@/components/layout/EditDrawer';

describe('EditDrawer', () => {
  it('renders nothing when closed', () => {
    render(
      <EditDrawer open={false} onClose={() => {}} title="Edit loan">
        <div>form body</div>
      </EditDrawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog with the title and children when open', () => {
    render(
      <EditDrawer open onClose={() => {}} title="Edit loan" description="Change the loan's terms.">
        <div>form body</div>
      </EditDrawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit loan' });
    expect(dialog).toHaveTextContent('form body');
    expect(dialog).toHaveTextContent("Change the loan's terms.");
  });

  it('closes on Escape (Radix) and on the X button', () => {
    const onClose = vi.fn();
    render(
      <EditDrawer open onClose={onClose} title="Edit loan">
        <div>form body</div>
      </EditDrawer>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does NOT close on outside interaction (mid-type persistence)', () => {
    const onClose = vi.fn();
    render(
      <EditDrawer open onClose={onClose} title="Edit loan">
        <div>form body</div>
      </EditDrawer>,
    );
    // Radix routes outside pointer-downs through onInteractOutside; the
    // overlay carries data-state=open. Clicking it must not dismiss.
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay!);
    fireEvent.click(overlay!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
