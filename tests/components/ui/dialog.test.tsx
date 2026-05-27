import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

/**
 * W6-Design: dialog.tsx used to set `aria-describedby={undefined}`
 * unconditionally, which silenced the Radix "Missing Description" dev
 * warning but ALSO clobbered Radix's context-based auto-wiring when a
 * caller DID render <DialogDescription>. These tests pin down both
 * sides of the new contract:
 *   1. With <DialogDescription>, Radix auto-wires aria-describedby to
 *      the description element's id (the regression we're fixing).
 *   2. A caller-provided aria-describedby still flows through props.
 */
describe('DialogContent — aria-describedby (W6-Design)', () => {
  it('auto-wires aria-describedby when DialogDescription is present', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>An accessible description.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toBe('');
    // The id should resolve to an element containing the description text.
    const descEl = describedBy ? document.getElementById(describedBy) : null;
    expect(descEl).not.toBeNull();
    expect(descEl?.textContent).toMatch(/an accessible description/i);
  });

  it('honours a caller-provided aria-describedby prop', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby="my-custom-desc">
          <DialogTitle>Title</DialogTitle>
          <p id="my-custom-desc">Out-of-tree description</p>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-describedby')).toBe('my-custom-desc');
  });
});
