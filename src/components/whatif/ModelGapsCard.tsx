/**
 * W3 — "What the model doesn't know yet" (D-W3-13). Pure render over
 * buildModelGaps; zero rows ⇒ null (absence is the calm outcome). The only
 * literal here is the card title (CR-6). Links go to one-place-per-thing
 * homes; this card never edits anything. No clamps (656d1bae lesson).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildModelGaps, type ModelGapsInput } from '@/lib/model-gaps';

export function ModelGapsCard({ input }: { input: ModelGapsInput }) {
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
            {model.rows.map((r) => (
              <li key={r.id} className="text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span>{r.text}</span>
                <Link
                  to={r.cta.to}
                  className="text-primary underline underline-offset-4 hover:text-primary/80 whitespace-nowrap"
                >
                  {r.cta.label}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </section>
    </Card>
  );
}

export default ModelGapsCard;
