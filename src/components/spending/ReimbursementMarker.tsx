import { reimbursementMarker } from '@/lib/reimbursement-status';
import type { Transaction } from '@/types/schema';

/**
 * v1.7.1 R10 (chip A-10a): a transaction's saved reimbursement state, as a
 * second line inside its AMOUNT cell on both Spending lists — the state says
 * how that amount counts. It sits outside the merchant cell, whose exact
 * accessible name the e2e specs pin (CR-R10-3), and adds no column, so the
 * lists keep their widths at 1024 px. The leading space keeps the cell's
 * name "$132.40 Reimbursed" rather than "$132.40Reimbursed" wherever layout
 * is not consulted. Renders nothing for a row with no state.
 */
export function ReimbursementMarker({
  t,
}: {
  t: Pick<Transaction, 'reimbursable' | 'reimbursedAt'>;
}) {
  const marker = reimbursementMarker(t);
  if (marker == null) return null;
  return (
    <>
      {' '}
      <span className="block text-xs text-muted-foreground" data-testid="reimbursement-marker">
        {marker}
      </span>
    </>
  );
}
