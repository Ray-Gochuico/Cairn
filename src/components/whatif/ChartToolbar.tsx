import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useScenariosStore } from '@/stores/scenarios-store';
import { ProjectionDetailLevel } from '@/types/enums';
import { TermTooltip } from '@/components/ui/glossary-tooltip';

interface ChartToolbarProps {
  detailLevel: ProjectionDetailLevel;
  onDetailLevelChange: (level: ProjectionDetailLevel) => void;
}

/**
 * Inline ⓘ info-button placed beside a toggle button. We can't put a
 * <TermTooltip> *inside* the toggle button (nested <button> is invalid
 * HTML and would break the toggle's aria-pressed semantics). Placing a
 * separately-focusable TermTooltip beside it preserves the toggle role,
 * keeps every glossary term hoverable / focus-reachable, and matches
 * the pattern Wave-3 UX W3-2 recommended for closing the jargon-spike
 * on the What-If toolbar.
 */
function LabelTooltip({ term }: { term: string }) {
  return (
    <span className="inline-flex items-center text-muted-foreground">
      <TermTooltip term={term}>
        <span className="sr-only">Definition for {term}</span>
      </TermTooltip>
    </span>
  );
}

export default function ChartToolbar({ detailLevel, onDetailLevelChange }: ChartToolbarProps) {
  const horizonMonths     = useScenariosStore((s) => s.horizonMonths);
  const dollarMode        = useScenariosStore((s) => s.dollarMode);
  const setHorizonMonths  = useScenariosStore((s) => s.setHorizonMonths);
  const setDollarMode     = useScenariosStore((s) => s.setDollarMode);

  const years = Math.round(horizonMonths / 12);

  // Labels with their glossary keys. The render block emits both the
  // toggle Button (carrying aria-pressed) AND a sibling TermTooltip
  // info-button so each term gets its own definition popover without
  // breaking the toggle role.
  const levels: { value: ProjectionDetailLevel; label: string; glossaryTerm: string }[] = [
    { value: ProjectionDetailLevel.SINGLE,      label: 'Single',      glossaryTerm: 'Single' },
    { value: ProjectionDetailLevel.TAX_BUCKET,  label: 'Tax bucket',  glossaryTerm: 'tax bucket' },
    { value: ProjectionDetailLevel.PER_ACCOUNT, label: 'Per account', glossaryTerm: 'Per account' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex flex-col gap-1 min-w-[200px]">
        <Label htmlFor="whatif-horizon">
          Horizon: <span className="font-mono">{years} years</span>
        </Label>
        <input
          id="whatif-horizon"
          type="range"
          min={60}
          max={480}
          step={12}
          value={horizonMonths}
          onChange={(e) => setHorizonMonths(Number(e.target.value))}
          aria-label="Projection horizon (months)"
          className="w-full"
        />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Dollar mode">
        <Label className="text-sm">
          <TermTooltip term="Nominal vs Real">Dollars</TermTooltip>:
        </Label>
        <Button
          variant={dollarMode === 'nominal' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={dollarMode === 'nominal'}
          onClick={() => setDollarMode('nominal')}
        >
          Nominal
        </Button>
        <LabelTooltip term="Nominal" />
        <Button
          variant={dollarMode === 'real' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={dollarMode === 'real'}
          onClick={() => setDollarMode('real')}
        >
          Real
        </Button>
        <LabelTooltip term="Real" />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Projection detail level">
        <Label className="text-sm">
          <TermTooltip term="Projection detail level">Detail</TermTooltip>:
        </Label>
        {levels.map(({ value, label, glossaryTerm }) => (
          // Per Wave-3 UX W3-2: each toggle gets its own glossary
          // definition via a sibling info button (TermTooltip).
          <span key={value} className="inline-flex items-center gap-1">
            <Button
              variant={detailLevel === value ? 'default' : 'outline'}
              size="sm"
              aria-pressed={detailLevel === value}
              onClick={() => onDetailLevelChange(value)}
            >
              {label}
            </Button>
            <LabelTooltip term={glossaryTerm} />
          </span>
        ))}
      </div>
    </div>
  );
}
