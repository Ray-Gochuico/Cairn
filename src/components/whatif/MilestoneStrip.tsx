import type { Scenario } from '@/types/scenario';
import type { Milestones } from '@/lib/scenarios';
import { formatMonth } from '@/lib/format';

interface MilestoneStripProps {
  scenarios: Scenario[];
  milestones: Map<number, Milestones>;
}

// Round-3 S9: delegate to the shared formatter (this file hand-rolled its own
// month names while ScenariosPanel on the SAME page rendered '2046/01').
// Invalid inputs keep the existing em-dash guards.
function fmtMonth(monthISO?: string): string {
  if (!monthISO) return '—';
  const [y, m] = monthISO.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return '—';
  return formatMonth(monthISO);
}

export default function MilestoneStrip({ scenarios, milestones }: MilestoneStripProps) {
  const visible = scenarios.filter((s) => s.visible);
  if (visible.length === 0) {
    return <div className="text-sm text-muted-foreground py-2">No scenarios visible.</div>;
  }
  return (
    <div className="flex flex-wrap gap-3 py-2">
      {visible.map((s) => {
        const m = s.id != null ? milestones.get(s.id) : undefined;
        return (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
          >
            <span
              data-testid={`milestone-swatch-${s.id}`}
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="font-medium">{s.name}</span>
            <span className="text-muted-foreground">·</span>
            <span>Debt-free {fmtMonth(m?.debtFreeISO)}</span>
            <span className="text-muted-foreground">·</span>
            <span>FI {fmtMonth(m?.financialIndependenceISO)}</span>
          </div>
        );
      })}
    </div>
  );
}
