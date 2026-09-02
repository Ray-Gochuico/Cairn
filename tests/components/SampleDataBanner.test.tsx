import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SampleDataBanner } from '@/components/layout/SampleDataBanner';
import * as transitions from '@/lib/explore-transitions';

describe('SampleDataBanner', () => {
  it('carries the full copy contract under role="note"', () => {
    render(<SampleDataBanner />);
    const note = screen.getByRole('note', { name: 'Sample data notice' });
    expect(note).toHaveTextContent('Sample data — nothing here is yours.');
    expect(note).toHaveTextContent("It disappears when you leave — changes here aren't saved.");
  });

  it('the action button exits explore', () => {
    const exit = vi.spyOn(transitions, 'exitExploreMode').mockResolvedValue(undefined);
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my real setup' }));
    expect(exit).toHaveBeenCalledTimes(1);
    exit.mockRestore();
  });

  it('is not dismissible — no close affordance of any kind', () => {
    render(<SampleDataBanner />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Start my real setup');
  });
});
