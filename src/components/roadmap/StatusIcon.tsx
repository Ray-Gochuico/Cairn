import {
  Check,
  ArrowRight,
  HelpCircle,
  Circle,
  MinusCircle,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeStatus } from '@/types/roadmap';

/**
 * Each status entry carries both a short `label` (the bare status word,
 * used for `aria-label`) and a longer `tooltip` (the human-readable name
 * surfaced via the native `title` attribute on hover and used by the
 * `<StatusLegend />` on the Roadmap page).
 *
 * Wave-7 UX MF-2: prior implementation had only `label`, so hovering an
 * icon revealed nothing and there was no on-page legend explaining what
 * each shape meant. Adding `tooltip` + StatusLegend closes both gaps.
 */
const MAP: Record<
  NodeStatus,
  { Icon: LucideIcon; cls: string; label: string; tooltip: string }
> = {
  done: { Icon: Check, cls: 'text-success-foreground', label: 'done', tooltip: 'Done' },
  active: { Icon: ArrowRight, cls: 'text-info-foreground', label: 'active', tooltip: 'Active — your current focus' },
  unanswered: {
    Icon: HelpCircle,
    cls: 'text-warning-foreground',
    label: 'unanswered',
    tooltip: 'Unanswered — needs input',
  },
  'not-started': {
    Icon: Circle,
    cls: 'text-muted-foreground',
    label: 'not started',
    tooltip: 'Not started',
  },
  skipped: {
    Icon: MinusCircle,
    cls: 'text-muted-foreground',
    label: 'skipped',
    tooltip: 'Skipped or not applicable',
  },
  info: { Icon: Info, cls: 'text-muted-foreground', label: 'info', tooltip: 'Info — read-only chart relay' },
};

interface StatusIconProps {
  status: NodeStatus;
  className?: string;
}

/**
 * Single source of truth for status iconography across the Roadmap UI.
 * Reused by NodeRow, the SectionCard active-indicator, and NextMoveHero
 * (the Dashboard's next-move surface is a W13 briefing feed row now).
 *
 * Carries both an `aria-label` (the bare status word, kept stable for
 * the test contract) and a native `title` attribute (the human-readable
 * tooltip surfaced on hover). The two intentionally diverge — `title`
 * adds context ("Active — your current focus") that would clutter the
 * screen-reader announcement.
 */
export function StatusIcon({ status, className }: StatusIconProps) {
  const { Icon, cls, label, tooltip } = MAP[status];
  return (
    <Icon
      className={cn('h-4 w-4', cls, className)}
      aria-label={label}
      role="img"
    >
      <title>{tooltip}</title>
    </Icon>
  );
}

/**
 * Roadmap status-icon legend — a horizontal strip that renders every
 * NodeStatus icon next to its tooltip text. Anchored at the top of the
 * Roadmap page so users have an at-a-glance reference for what each
 * shape means.
 *
 * Status order is intentional: progression first (Active → Not started
 * → Done → Skipped), then informational shapes (Unanswered, Info).
 * Wave-7 UX MF-2.
 */
const LEGEND_ORDER: NodeStatus[] = [
  'active',
  'not-started',
  'done',
  'skipped',
  'unanswered',
  'info',
];

export function StatusLegend({ className }: { className?: string }) {
  return (
    <div
      role="list"
      aria-label="Status legend"
      data-testid="roadmap-status-legend"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground',
        className,
      )}
    >
      {LEGEND_ORDER.map((status) => {
        const { tooltip } = MAP[status];
        return (
          <span
            key={status}
            role="listitem"
            className="inline-flex items-center gap-1.5"
          >
            <StatusIcon status={status} />
            <span>{tooltip}</span>
          </span>
        );
      })}
    </div>
  );
}

export default StatusIcon;
