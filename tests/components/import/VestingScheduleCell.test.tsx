import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VestingScheduleCell } from '@/components/import/VestingScheduleCell';

const VALID_JSON = JSON.stringify([
  { date: '2026-01-01', cumulativePct: 0.25 },
  { date: '2029-01-01', cumulativePct: 1.0 },
]);

describe('VestingScheduleCell', () => {
  it('shows a compact summary of valid schedules', () => {
    render(<VestingScheduleCell value={VALID_JSON} onChange={() => {}} />);
    expect(screen.getByText(/2 rows/i)).toBeInTheDocument();
    // Summary contains the first → last percentage
    expect(screen.getByText(/25%/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('renders the error message when `error` is set', () => {
    render(
      <VestingScheduleCell
        value="garbage"
        onChange={() => {}}
        error={{ field: 'vesting_schedule_json', message: 'Invalid JSON' }}
      />,
    );
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
  });

  it('opens a textarea editor when the user clicks Edit', () => {
    render(<VestingScheduleCell value={VALID_JSON} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onChange when the textarea value changes', () => {
    const onChange = vi.fn();
    render(<VestingScheduleCell value={VALID_JSON} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '[]' } });
    expect(onChange).toHaveBeenCalledWith('[]');
  });

  it('shows "No schedule" when the value parses to empty/non-array', () => {
    render(<VestingScheduleCell value="{}" onChange={() => {}} />);
    expect(screen.getByText(/No schedule/i)).toBeInTheDocument();
  });
});
