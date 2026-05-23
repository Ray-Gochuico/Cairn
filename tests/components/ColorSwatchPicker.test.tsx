import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ColorSwatchPicker } from '@/components/forms/ColorSwatchPicker';
import { SWATCH_OPTIONS } from '@/components/charts/palette';

describe('ColorSwatchPicker', () => {
  it('renders 30 swatch buttons plus a Default tile', () => {
    render(
      <MemoryRouter>
        <ColorSwatchPicker value={null} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    for (const hex of SWATCH_OPTIONS) {
      expect(screen.getByRole('button', { name: `Color ${hex}` })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /default color/i })).toBeInTheDocument();
  });

  it('fires onChange with the hex when a swatch is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ColorSwatchPicker value={null} onChange={onChange} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: `Color ${SWATCH_OPTIONS[0]}` }));
    expect(onChange).toHaveBeenCalledWith(SWATCH_OPTIONS[0]);
  });

  it('fires onChange with null when the Default tile is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ColorSwatchPicker value="#4c78a8" onChange={onChange} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /default color/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('marks the selected swatch as pressed', () => {
    render(
      <MemoryRouter>
        <ColorSwatchPicker value={SWATCH_OPTIONS[3]} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: `Color ${SWATCH_OPTIONS[3]}` }),
    ).toHaveAttribute('aria-pressed', 'true');
    // The Default tile is not pressed when a swatch is selected.
    expect(
      screen.getByRole('button', { name: /default color/i }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the Default tile as pressed when value is null', () => {
    render(
      <MemoryRouter>
        <ColorSwatchPicker value={null} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: /default color/i }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an optional label', () => {
    render(
      <MemoryRouter>
        <ColorSwatchPicker value={null} onChange={vi.fn()} label="Pick a color" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Pick a color')).toBeInTheDocument();
  });
});
