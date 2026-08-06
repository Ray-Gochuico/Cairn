import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';

interface Row {
  key: string;
  prompt: string;
  answer: string;
  reAsk: () => Promise<void>;
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/**
 * Wave C (DC1 — D1 option a): the read-only "Assumptions you've told the
 * Roadmap" list. The rule-engine chart answers are write-once via
 * DecisionPrompt and then invisible + immutable (IN-G2/G3/G4) — one wrong
 * click permanently steered the engine. Re-ask NULLs the answer column
 * (house confirm first); the rule's `unanswered` branch then re-renders
 * DecisionPrompt in its section above. Prompts mirror the rules verbatim
 * (section1/hsa/section4Misc/sections5to6). Registry scope: only answers
 * with NO form home — employer-match / mega-backdoor / the two interest
 * thresholds are editable in AccountForm / Settings→Advanced and stay there
 * (one-place-per-thing). This component only READS stores; /roadmap owns
 * hydration (boot-loop gotcha).
 */
export function RoadmapAssumptions() {
  const household = useHouseholdStore((s) => s.household);
  const updateHousehold = useHouseholdStore((s) => s.update);
  const persons = usePersonsStore((s) => s.persons);
  const updatePerson = usePersonsStore((s) => s.update);
  const accounts = useAccountsStore((s) => s.accounts);
  const updateAccount = useAccountsStore((s) => s.update);
  const { confirm, dialog } = useConfirm();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (household) {
      if (household.hasWrittenIps != null)
        out.push({
          key: 'hh-ips',
          prompt: 'Have you written an Investment Policy Statement (IPS)?',
          answer: yesNo(household.hasWrittenIps),
          reAsk: () => updateHousehold({ hasWrittenIps: null }),
        });
      if (household.hasHsaQualifiedHdhp != null)
        out.push({
          key: 'hh-hdhp',
          prompt: 'Are you currently on an HSA-qualified HDHP?',
          answer: yesNo(household.hasHsaQualifiedHdhp),
          reAsk: () => updateHousehold({ hasHsaQualifiedHdhp: null }),
        });
      if (household.makesCharitableGifts != null)
        out.push({
          key: 'hh-gifts',
          prompt: 'Do you make regular charitable gifts?',
          answer: yesNo(household.makesCharitableGifts),
          reAsk: () => updateHousehold({ makesCharitableGifts: null }),
        });
      if (household.upcomingLargePurchase != null)
        out.push({
          key: 'hh-purchase',
          prompt: 'Any large required purchases (house, car, tuition, etc.) in the next 3–5 years?',
          answer: yesNo(household.upcomingLargePurchase),
          // A stale amount under a re-asked answer would silently steer
          // s5_save_short_term — clear the follow-up figures with it.
          reAsk: () =>
            updateHousehold({
              upcomingLargePurchase: null,
              upcomingPurchaseAmount: null,
              upcomingPurchaseMonths: null,
            }),
        });
    }
    for (const p of persons) {
      if (p.id == null) continue;
      const id = p.id;
      if (p.jobStability != null)
        out.push({
          key: `p-${id}-job`,
          prompt: `Is ${p.name}'s job stable or unstable?`,
          answer: p.jobStability === 'stable' ? 'Stable' : 'Unstable',
          reAsk: () => updatePerson(id, { jobStability: null }),
        });
      if (p.expectsHigherFutureIncome != null)
        out.push({
          key: `p-${id}-roth`,
          prompt: `Do you expect ${p.name}'s future income to exceed the IRS Roth threshold?`,
          answer: yesNo(p.expectsHigherFutureIncome),
          reAsk: () => updatePerson(id, { expectsHigherFutureIncome: null }),
        });
    }
    for (const a of accounts) {
      if (a.id == null || a.hasHighFees == null) continue;
      const id = a.id;
      out.push({
        key: `a-${id}-fees`,
        prompt: `Does ${a.name} have high fees?`,
        answer: yesNo(a.hasHighFees),
        reAsk: () => updateAccount(id, { hasHighFees: null }),
      });
    }
    return out;
  }, [household, persons, accounts, updateHousehold, updatePerson, updateAccount]);

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="roadmap-assumptions-heading"
      data-testid="roadmap-assumptions"
      className="space-y-2 rounded-md border bg-card p-4"
    >
      <h2 id="roadmap-assumptions-heading" className="text-sm font-medium">
        Assumptions you’ve told the Roadmap
      </h2>
      <p className="text-xs text-muted-foreground">
        Answers you’ve given to Roadmap questions. Asking again clears the saved answer — the
        question reappears in its section above.
      </p>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 text-sm">{r.prompt}</span>
            <span className="text-sm text-muted-foreground">{r.answer}</span>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Ask again: ${r.prompt}`}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Ask this question again?',
                  description: `This clears your saved answer (“${r.answer}”) so the Roadmap asks it again. Nothing else about your data changes.`,
                  // Not a delete — reuse the CW12 row-button string so the
                  // dialog's action reads as what it does (the useConfirm
                  // default label is the destructive 'Delete').
                  confirmLabel: 'Ask again',
                });
                if (ok) await r.reAsk();
              }}
            >
              Ask again
            </Button>
          </li>
        ))}
      </ul>
      {dialog}
    </section>
  );
}

export default RoadmapAssumptions;
