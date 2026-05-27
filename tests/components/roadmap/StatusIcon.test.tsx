import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusIcon } from '@/components/roadmap/StatusIcon';
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
});
