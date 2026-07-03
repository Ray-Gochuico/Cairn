import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EditablePill } from '@/components/dashboard/EditablePill';

const noop = () => {};

function renderPill(overrides: Partial<Parameters<typeof EditablePill>[0]> = {}) {
  return render(
    <EditablePill
      id="p1"
      label="Spending"
      editing
      canMoveUp
      canMoveDown
      onMoveUp={noop}
      onMoveDown={noop}
      onRemove={noop}
      {...overrides}
    >
      <button type="button">inner action</button>
    </EditablePill>,
  );
}

describe('EditablePill edit-mode shield', () => {
  it('marks the children wrapper inert while editing (unreachable by Tab/AT)', () => {
    renderPill();
    // jsdom reflects the attribute; browsers enforce the focus/AT behavior.
    expect(screen.getByTestId('pill-p1-content')).toHaveAttribute('inert');
  });

  it('children are not inert when not editing', () => {
    renderPill({ editing: false });
    expect(screen.getByTestId('pill-p1-content')).not.toHaveAttribute('inert');
  });

  it('hands focus to the counterpart when a focused move button disables at the boundary', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [canUp, setCanUp] = useState(true);
      return (
        <EditablePill
          id="p1"
          label="Spending"
          editing
          canMoveUp={canUp}
          canMoveDown
          onMoveUp={() => setCanUp(false)} // reached the front
          onMoveDown={noop}
          onRemove={noop}
        >
          <div>content</div>
        </EditablePill>
      );
    }
    render(<Harness />);
    const up = screen.getByRole('button', { name: 'Move Spending earlier' });
    await user.click(up); // click focuses, then the button disables
    expect(up).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Spending later' })).toHaveFocus();
  });
});
