import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CardEditFrame from '@/components/investments/CardEditFrame';

const noop = () => {};

describe('CardEditFrame', () => {
  it('shows the label and Hide for a visible card', () => {
    render(
      <CardEditFrame label="Sector exposure" hidden={false} canMoveUp canMoveDown
        onToggleHidden={noop} onMoveUp={noop} onMoveDown={noop}>
        <div>body</div>
      </CardEditFrame>,
    );
    expect(screen.getByText('Sector exposure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide sector exposure/i })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('shows Show for a hidden card and fires the toggle', () => {
    const onToggle = vi.fn();
    render(
      <CardEditFrame label="Sector exposure" hidden canMoveUp canMoveDown
        onToggleHidden={onToggle} onMoveUp={noop} onMoveDown={noop}>
        <div>body</div>
      </CardEditFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: /show sector exposure/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('disables the up arrow at the top and fires move down', () => {
    const onDown = vi.fn();
    render(
      <CardEditFrame label="Growth" hidden={false} canMoveUp={false} canMoveDown
        onToggleHidden={noop} onMoveUp={noop} onMoveDown={onDown}>
        <div>body</div>
      </CardEditFrame>,
    );
    expect(screen.getByRole('button', { name: /move growth up/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /move growth down/i }));
    expect(onDown).toHaveBeenCalledOnce();
  });
});
