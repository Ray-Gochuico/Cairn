/**
 * W3 — "What the model doesn't know yet" (D-W3-13). Pure render over
 * buildModelGaps; zero rows ⇒ null (absence is the calm outcome). The only
 * literal here is the card title (CR-6). Links go to one-place-per-thing
 * homes; this card never edits anything. No clamps (656d1bae lesson).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildModelGaps, isLeverAction, type ModelGapsInput } from '@/lib/model-gaps';

// One class string for both CTA shapes — a route link and an in-page action
// read identically (the register never distinguishes them visually).
const CTA_CLASS = 'text-primary underline underline-offset-4 hover:text-primary/80 whitespace-nowrap';

export function ModelGapsCard({
  input,
  onOpenLever,
}: {
  input: ModelGapsInput;
  /** C2: the page's in-page handler for lever-action rows (G11). Absent →
   *  the row states its fact and renders no control (never a dead button). */
  onOpenLever?: (scenarioId: number, lever: 'expenses') => void;
}) {
  const model = useMemo(() => buildModelGaps(input), [input]);
  if (model.rows.length === 0) return null;
  return (
    <Card className="min-w-0" data-testid="whatif-model-gaps-card">
      <section aria-labelledby="model-gaps-heading">
        <CardHeader className="pb-2">
          <CardTitle id="model-gaps-heading" className="text-base">
            What the model doesn&apos;t know yet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {model.rows.map((r) => {
              const cta = r.cta;
              return (
                <li key={r.id} className="text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {/* C2: a lever-action row (G11) names a $0 expense base — its text
                      carries a testid so the page's W5.1 basis registry classifies
                      that figure (invariant: $0 in either basis). */}
                  <span data-testid={isLeverAction(cta) ? 'whatif-model-gap-expense-base' : undefined}>{r.text}</span>
                  {isLeverAction(cta) ? (
                    onOpenLever ? (
                      <button
                        type="button"
                        className={CTA_CLASS}
                        onClick={() => onOpenLever(cta.scenarioId, cta.lever)}
                      >
                        {cta.label}
                      </button>
                    ) : null
                  ) : (
                    <Link to={cta.to} className={CTA_CLASS}>
                      {cta.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </section>
    </Card>
  );
}

export default ModelGapsCard;
