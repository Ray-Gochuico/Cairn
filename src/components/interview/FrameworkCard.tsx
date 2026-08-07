import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { DecisionPrompt } from '@/components/roadmap/DecisionPrompt';
import { usePersonsStore } from '@/stores/persons-store';
import type { FrameworkCardModel } from '@/lib/interview/framework-cards';
import { InterviewDisclosureSheet } from './InterviewDisclosureSheet';

/**
 * One mechanical framework card (design §2.3): header, split table,
 * headline effect + secondaries, collapsed "What this assumes" (native
 * <details>, D-GI12), fixed CI-5 footer. Pure render over the model — all
 * copy is built in lib (framework-cards.ts / effects.ts).
 */
export function FrameworkCard({ model }: { model: FrameworkCardModel }) {
  const renderRows = (rows: FrameworkCardModel['rows'], showFor: boolean) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground text-left">
          <th className="font-normal">Destination</th>
          <th className="font-normal text-right">{model.cadence === 'per-month' ? '$/mo' : 'Amount'}</th>
          {showFor && <th className="font-normal text-right">For</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.label}</td>
            <td className="text-right tabular-nums">{r.amount}</td>
            {showFor && <td className="text-right text-muted-foreground">{r.forLabel}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Card className="p-4 flex flex-col gap-3" data-testid={`framework-${model.policyId}`}>
      <div className="text-sm font-semibold">{model.title}</div>
      {model.cadence === 'one-time'
        ? renderRows(model.rows, false)
        : model.phases.map((p) => (
            <div key={p.label}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{p.label}</div>
              {renderRows(p.rows, true)}
            </div>
          ))}
      {/* M1: a suppressed CI-28 line leaves an empty headline — render nothing. */}
      {model.headline !== '' && <p className="text-sm">{model.headline}</p>}
      {model.secondaries.map((s, i) => (
        <p key={i} className="text-xs text-muted-foreground">{s}</p>
      ))}
      {model.askJobStability && (
        <DecisionPrompt
          question={{
            prompt: `Is ${model.askJobStability.name}'s job stable or unstable?`,
            answerType: 'enum',
            options: [
              { value: 'stable', label: 'Stable' },
              { value: 'unstable', label: 'Unstable' },
            ],
            onAnswer: async (value) => {
              // One-place-per-thing: the SAME write-through the roadmap node
              // uses (section1.ts jobStability idiom) — the card recomputes
              // reactively.
              await usePersonsStore.getState().update(model.askJobStability!.personId, {
                jobStability: value as 'stable' | 'unstable',
              });
            },
          }}
        />
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">What this assumes</summary>
        <ul className="mt-1 space-y-1 list-disc pl-4">
          {model.assumes.map((a, i) => (
            <li key={i}>
              {a.text}
              {a.cta && (
                <>
                  {' '}
                  <Link className="underline hover:no-underline" to={a.cta.to}>{a.cta.label}</Link>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
      <div className="text-xs text-muted-foreground border-t pt-2 flex items-center justify-between gap-2">
        <span>{model.footer}</span>
        <InterviewDisclosureSheet />
      </div>
    </Card>
  );
}
