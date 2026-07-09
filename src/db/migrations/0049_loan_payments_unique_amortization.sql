-- Wave-9 M37: the Monthly ritual could re-record a confirmed loan payment
-- (revisit the check-in in the same month → duplicate row + double balance
-- decrement). Dedupe any existing AMORTIZATION duplicates (keep the earliest
-- row per (loan_id, payment_date) — the later ones are the corruption), then
-- enforce uniqueness going forward. The index is PARTIAL on
-- source='AMORTIZATION' so legitimate same-day MANUAL/IMPORTED rows stay
-- legal. NOTE: doubly-decremented loans.current_balance values are NOT
-- reconstructible from these rows and are not corrected here.
DELETE FROM loan_payments
WHERE source = 'AMORTIZATION'
  AND id NOT IN (
    SELECT MIN(id) FROM loan_payments
    WHERE source = 'AMORTIZATION'
    GROUP BY loan_id, payment_date
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_payments_amortization_unique
  ON loan_payments (loan_id, payment_date)
  WHERE source = 'AMORTIZATION';
