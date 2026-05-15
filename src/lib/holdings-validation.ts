// src/lib/holdings-validation.ts
export type ValidationResult =
  | { ok: true }
  | { ok: false; sum: number; cap: number; message: string };

export function validateAccountTargetPct(
  holdings: Array<{ targetAllocationPct: number | null }>,
  account: { allowMargin: boolean },
): ValidationResult {
  const sum = holdings.reduce(
    (a, h) => a + (h.targetAllocationPct ?? 0),
    0,
  );
  if (account.allowMargin) return { ok: true };
  const cap = 1.0;
  if (sum <= cap + 1e-9) return { ok: true };
  return {
    ok: false,
    sum,
    cap,
    message: `Target allocations sum to ${(sum * 100).toFixed(1)}% (cap: 100%). Enable margin on the account to allow >100%.`,
  };
}
