import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusIcon, StatusLegend } from '@/components/roadmap/StatusIcon';
import type { NodeStatus } from '@/types/roadmap';

describe('StatusIcon', () => {
  // Semantic-token classes (--success / --info / --warning / muted) replaced
  // the raw emerald/blue/amber/slate utilities in the 2026-05-27 design
  // polish sweep. Asserts shape, not exact hex.
  const STATUS_COLOR: Record<NodeStatus, string> = {
    done: 'text-success',
    active: 'text-info',
    unanswered: 'text-warning',
    'not-started': 'text-muted-foreground',
    skipped: 'text-muted-foreground',
    info: 'text-muted-foreground',
  };

  for (const [status, cls] of Object.entries(STATUS_COLOR) as [NodeStatus, string][]) {
    it(`renders a ${status} icon with ${cls}`, () => {
      const { container } = render(<StatusIcon status={status} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.className.baseVal ?? svg?.getAttribute('class')).toContain(cls);
    });
  }

  it('uses an aria-label matching the status name', () => {
    const { container } = render(<StatusIcon status="unanswered" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBe('unanswered');
  });

  it('renders skipped with a "skipped" label', () => {
    const { container } = render(<StatusIcon status="skipped" />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'skipped',
    );
  });

  it('appends the user-supplied className', () => {
    const { container } = render(
      <StatusIcon status="done" className="extra-cls" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('extra-cls');
  });

  // Wave-7 UX MF-2: each icon now carries an inline <title> child so
  // mouse hover surfaces a human-readable name (e.g. "Active — your
  // current focus") in addition to the bare `aria-label`. SVG <title>
  // is the spec-compliant equivalent of a `title` attribute on
  // non-replaced elements; browsers render it as a tooltip.
  const STATUS_TOOLTIP: Record<NodeStatus, string> = {
    done: 'Done',
    active: 'Active — your current focus',
    unanswered: 'Unanswered — needs input',
    'not-started': 'Not started',
    skipped: 'Skipped or not applicable',
    info: 'Info — read-only chart relay',
  };
  for (const [status, tooltip] of Object.entries(STATUS_TOOLTIP) as [
    NodeStatus,
    string,
  ][]) {
    it(`renders an SVG <title> "${tooltip}" for the ${status} icon`, () => {
      const { container } = render(<StatusIcon status={status} />);
      const title = container.querySelector('svg > title');
      expect(title?.textContent).toBe(tooltip);
    });
  }
});

describe('StatusLegend', () => {
  it('renders a list with one item per status', () => {
    render(<StatusLegend />);
    const legend = screen.getByTestId('roadmap-status-legend');
    expect(legend).toBeInTheDocument();
    // Six statuses → six list items.
    const items = legend.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(6);
  });

  it('labels each legend item with the human-readable tooltip text', () => {
    render(<StatusLegend />);
    // Every tooltip appears as a visible label. Each label appears
    // twice in the DOM — once inside the SVG <title> (tooltip text)
    // and once in the visible <span> next to it — so scope the
    // assertion to <span> elements to avoid getByText's multi-match
    // error. Selector matches both `span` elements (visible labels) but
    // not the SVG `title` (which lives inside the icon).
    const spanFor = (label: string) =>
      Array.from(document.querySelectorAll('span')).find(
        (s) => s.textContent === label,
      );
    expect(spanFor('Active — your current focus')).toBeTruthy();
    expect(spanFor('Done')).toBeTruthy();
    expect(spanFor('Not started')).toBeTruthy();
    expect(spanFor('Skipped or not applicable')).toBeTruthy();
    expect(spanFor('Unanswered — needs input')).toBeTruthy();
    expect(spanFor('Info — read-only chart relay')).toBeTruthy();
  });

  it('exposes a "Status legend" accessible name on the list', () => {
    render(<StatusLegend />);
    const legend = screen.getByRole('list', { name: /status legend/i });
    expect(legend).toBeInTheDocument();
  });
});
