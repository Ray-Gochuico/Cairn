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

const MAP: Record<NodeStatus, { Icon: LucideIcon; cls: string; label: string }> = {
  done: { Icon: Check, cls: 'text-success', label: 'done' },
  active: { Icon: ArrowRight, cls: 'text-info', label: 'active' },
  unanswered: { Icon: HelpCircle, cls: 'text-warning', label: 'unanswered' },
  'not-started': { Icon: Circle, cls: 'text-muted-foreground', label: 'not started' },
  skipped: { Icon: MinusCircle, cls: 'text-muted-foreground', label: 'skipped' },
  info: { Icon: Info, cls: 'text-muted-foreground', label: 'info' },
};

interface StatusIconProps {
  status: NodeStatus;
  className?: string;
}

/**
 * Single source of truth for status iconography across the Roadmap UI.
 * Reused by NodeRow, SectionCard active-indicator, NextMoveHero, and the
 * Dashboard NextMoveCard in Sub-Plan D.
 */
export function StatusIcon({ status, className }: StatusIconProps) {
  const { Icon, cls, label } = MAP[status];
  return (
    <Icon
      className={cn('h-4 w-4', cls, className)}
      aria-label={label}
      role="img"
    />
  );
}

export default StatusIcon;
