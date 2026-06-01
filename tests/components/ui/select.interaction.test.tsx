import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

describe('Select (Radix) interaction', () => {
  it('opens and selects an option, calling onValueChange with the value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>,
    );

    // Open the dropdown
    await user.click(screen.getByRole('combobox'));

    // Click an option
    await user.click(await screen.findByRole('option', { name: 'Beta' }));

    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('can select the first option as well', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Alpha' }));

    expect(onValueChange).toHaveBeenCalledWith('a');
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });
});
