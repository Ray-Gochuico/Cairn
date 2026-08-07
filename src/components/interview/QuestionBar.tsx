import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { useHouseholdStore } from '@/stores/household-store';
import { useInterviewBarStore } from '@/lib/interview/bar-store';
import { buildFrameworkCards } from '@/lib/interview/framework-cards';
import type { InterviewContext } from '@/types/interview';
import type { Cadence } from '@/types/interview';
import { FrameworkCard } from './FrameworkCard';

const MAX_DOLLARS = 10_000_000;

/**
 * The structured "$X — what's next?" bar (design §2). Session-only
 * hypothetical (D-GI13); first submission gated by DISCLOSURES.interview
 * (§2.2). Renders three FrameworkCards computed live from the kernel's
 * pure pipeline. Household-scoped by page declaration; no free text.
 */
export function QuestionBar({ ctx }: { ctx: InterviewContext }) {
  const gate = useDisclosureGate('interview');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const { amount, cadence, submitted, setAmount, setCadence, submit } = useInterviewBarStore();
  const [gateOpen, setGateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trySubmit = () => {
    if (amount == null || amount <= 0 || amount > MAX_DOLLARS) {
      setError('Enter an amount over $0 and at most $10,000,000.');
      return;
    }
    setError(null);
    if (gate.state === 'needs-acceptance') {
      setGateOpen(true);
      return;
    }
    submit();
  };

  const cards = useMemo(
    () => (submitted ? buildFrameworkCards(submitted, ctx) : null),
    [submitted, ctx],
  );

  const cadenceButton = (value: Cadence, label: string) => (
    <button
      type="button"
      aria-pressed={cadence === value}
      className={`px-2 py-1 text-sm rounded ${cadence === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
      onClick={() => setCadence(value)}
    >
      {label}
    </button>
  );

  return (
    <section aria-label="What's next question bar" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>I have</span>
        <div className="w-32">
          <MoneyInput aria-label="Amount" value={amount} onValueChange={setAmount}
            onKeyDown={(e) => { if (e.key === 'Enter') trySubmit(); }} />
        </div>
        <div role="group" aria-label="Cadence" className="flex rounded border">
          {cadenceButton('one-time', 'One-time')}
          {cadenceButton('per-month', 'Per month')}
        </div>
        <span>— what's next?</span>
        <Button size="sm" onClick={trySubmit}>Show me</Button>
      </div>
      {error && (
        <div className="text-xs text-destructive-soft-foreground" role="alert">{error}</div>
      )}
      {cards && (
        <div className="grid gap-3 md:grid-cols-3">
          {cards.map((m) => <FrameworkCard key={m.policyId} model={m} />)}
        </div>
      )}
      {gateOpen && gate.state === 'needs-acceptance' && (
        <DisclosureModal
          document={gate.document}
          continueLabel="Continue"
          // Smoke defect: Escape must not dismiss this gate — Cancel is the
          // only non-accept exit (Task 12 Step 6 point 2).
          dismissOnEscape={false}
          onAccept={async (v) => {
            await acceptDisclaimer('interview', v);
            setGateOpen(false);
            submit(); // the pending submission proceeds post-accept
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </section>
  );
}
