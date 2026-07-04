import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EditableWidget } from '@/components/dashboard/EditableWidget';

const noop = () => {};

function renderWidget(overrides: Partial<Parameters<typeof EditableWidget>[0]> = {}) {
  return render(
    <EditableWidget
      id="w1"
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
    </EditableWidget>,
  );
}

describe('EditableWidget edit-mode shield', () => {
  it('marks the children wrapper inert while editing (unreachable by Tab/AT)', () => {
    renderWidget();
    // jsdom reflects the attribute; browsers enforce the focus/AT behavior.
    expect(screen.getByTestId('widget-w1-content')).toHaveAttribute('inert');
  });

  it('children are not inert when not editing', () => {
    renderWidget({ editing: false });
    expect(screen.getByTestId('widget-w1-content')).not.toHaveAttribute('inert');
  });

  it('hands focus to the counterpart when a focused move button disables at the boundary', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [canUp, setCanUp] = useState(true);
      return (
        <EditableWidget
          id="w1"
          label="Spending"
          editing
          canMoveUp={canUp}
          canMoveDown
          onMoveUp={() => setCanUp(false)} // reached the top
          onMoveDown={noop}
          onRemove={noop}
        >
          <div>content</div>
        </EditableWidget>
      );
    }
    render(<Harness />);
    const up = screen.getByRole('button', { name: 'Move Spending up' });
    await user.click(up); // click focuses, then the button disables
    expect(up).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Spending down' })).toHaveFocus();
  });
});
