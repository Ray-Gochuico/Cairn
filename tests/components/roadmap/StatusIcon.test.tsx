import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusIcon } from '@/components/roadmap/StatusIcon';
import type { NodeStatus } from '@/types/roadmap';

describe('StatusIcon', () => {
  const STATUS_COLOR: Record<NodeStatus, string> = {
    done: 'text-emerald-600',
    active: 'text-blue-600',
    unanswered: 'text-amber-600',
    'not-started': 'text-slate-400',
    skipped: 'text-slate-400',
    info: 'text-slate-500',
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
