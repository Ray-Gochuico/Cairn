import { formatCurrency } from '@/lib/format';
import type { PreferenceNode, StoredAnswerView } from '@/types/interview';
import { monthYearLabel } from './kernel-dates';

/**
 * F12 (R4, CR-AP-2): the CI-36 "Your earlier answer" label BY KIND — never
 * String(value) (a compound prior rendered "[object Object]"). The prior is
 * parsed through the node's OWN schema first (a legacy college object on a
 * month-year node formats as its month through the tolerant read); an
 * unparseable prior yields null and ThreadCard renders no preamble (D-GI16).
 */
export function priorAnswerLabel(node: PreferenceNode, prior: StoredAnswerView | null): string | null {
  if (prior == null) return null;
  const parsed = node.valueSchema.safeParse(prior.value);
  if (!parsed.success) return null;
  const v = parsed.data;
  switch (node.answer.kind) {
    case 'enum':
      return node.answer.options.find((o) => o.value === v)?.label ?? null;
    case 'amount':
      return typeof v === 'number' ? formatCurrency(v) : null;
    case 'month-year':
      return typeof v === 'string' ? monthYearLabel(v) : null;
    case 'amount-month-year': {
      const t = v as { amountDollars: number; targetMonth: string };
      return `${formatCurrency(t.amountDollars)} by ${monthYearLabel(t.targetMonth)}`;
    }
    case 'amount-cadence':
      return null; // the bar owns it; never reaches ThreadCard
  }
}
