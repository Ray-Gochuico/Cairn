import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

describe('RadioGroup (Radix) interaction', () => {
  it('exposes radiogroup + radio roles and selects on click, firing onValueChange', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <RadioGroup aria-label="Plan type" defaultValue="a" onValueChange={onValueChange}>
        <label>
          <RadioGroupItem value="a" /> Alpha
        </label>
        <label>
          <RadioGroupItem value="b" /> Beta
        </label>
      </RadioGroup>,
    );

    const group = screen.getByRole('radiogroup', { name: 'Plan type' });
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked(); // defaultValue="a"
    expect(radios[1]).not.toBeChecked();

    await user.click(radios[1]);
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(radios[1]).toBeChecked();
  });

  it('supports arrow-key roving focus across the group', async () => {
    const user = userEvent.setup();

    render(
      <RadioGroup aria-label="Plan type" defaultValue="a">
        <RadioGroupItem value="a" aria-label="Alpha" />
        <RadioGroupItem value="b" aria-label="Beta" />
      </RadioGroup>,
    );

    const alpha = screen.getByRole('radio', { name: 'Alpha' });
    const beta = screen.getByRole('radio', { name: 'Beta' });

    await user.tab(); // roving focus lands on the checked radio (a)
    expect(alpha).toHaveFocus();

    await user.keyboard('{ArrowDown}'); // roving focus moves to the next radio (b)
    expect(beta).toHaveFocus();

    // (In a real browser the arrow also commits the selection via onValueChange;
    // jsdom moves roving focus but does not fire the focus-driven selection, so
    // the selection contract is asserted via the click path in the test above.)
  });
});
