import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OverrideDialog } from '@/components/roadmap/OverrideDialog';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { RoadmapNode } from '@/types/roadmap';

function makeNode(): RoadmapNode {
  return {
    id: 's1_employer_match',
    section: 1,
    kind: 'action',
    title: 'Capture the full employer match',
    body: '',
    prerequisites: [],
    evaluate: () => ({ status: 'active' }),
  };
}

describe('OverrideDialog', () => {
  let setOverride = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    setOverride = vi.fn().mockResolvedValue(undefined);
    useRoadmapOverridesStore.setState({
      overridesByNodeId: new Map(),
      isLoading: false,
      error: null,
      load: async () => {},
      setOverride,
      clearOverride: async () => {},
    } as any);
  });

  it('renders the three override choices when open', () => {
    render(
      <OverrideDialog
        node={makeNode()}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /^done/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^not started/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^skipped/i })).toBeInTheDocument();
  });

  it('renders the warning explaining override semantics (W7-Legal R-LWI-5)', () => {
    render(
      <OverrideDialog
        node={makeNode()}
        open
        onOpenChange={vi.fn()}
      />,
    );
    // The warning sits above the radio fieldset and explains that an
    // override pins a status against the engine's mechanical reading
    // and persists until cleared.
    expect(
      screen.getByText(/pinning a status against the engine.s mechanical reading/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/persists until you clear it/i),
    ).toBeInTheDocument();
  });

  it('writes the chosen status + note via the overrides store on Save', async () => {
    const onOpenChange = vi.fn();
    render(
      <OverrideDialog node={makeNode()} open onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /^skipped/i }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'not applicable to me' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(setOverride).toHaveBeenCalledWith(
        's1_employer_match',
        'skipped',
        'not applicable to me',
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('passes null as the note when the textarea is empty after trim', async () => {
    render(
      <OverrideDialog node={makeNode()} open onOpenChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(setOverride).toHaveBeenCalledWith(
        's1_employer_match',
        'done',
        null,
      );
    });
  });

  it('surfaces an inline error when setOverride rejects', async () => {
    setOverride.mockRejectedValueOnce(new Error('disk full'));
    render(
      <OverrideDialog node={makeNode()} open onOpenChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/disk full/i);
    });
  });

  it('cancels without writing when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <OverrideDialog node={makeNode()} open onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(setOverride).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
