import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useScenariosStore } from '@/stores/scenarios-store';
import { ProjectionDetailLevel } from '@/types/enums';

interface ChartToolbarProps {
  detailLevel: ProjectionDetailLevel;
  onDetailLevelChange: (level: ProjectionDetailLevel) => void;
}

export default function ChartToolbar({ detailLevel, onDetailLevelChange }: ChartToolbarProps) {
  const horizonMonths     = useScenariosStore((s) => s.horizonMonths);
  const dollarMode        = useScenariosStore((s) => s.dollarMode);
  const setHorizonMonths  = useScenariosStore((s) => s.setHorizonMonths);
  const setDollarMode     = useScenariosStore((s) => s.setDollarMode);

  const years = Math.round(horizonMonths / 12);

  const levels: { value: ProjectionDetailLevel; label: string }[] = [
    { value: ProjectionDetailLevel.SINGLE,      label: 'Single' },
    { value: ProjectionDetailLevel.TAX_BUCKET,  label: 'Tax bucket' },
    { value: ProjectionDetailLevel.PER_ACCOUNT, label: 'Per account' },
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

      <div className="flex items-center gap-1">
        <Label className="text-sm">Dollars:</Label>
        <Button
          variant={dollarMode === 'nominal' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={dollarMode === 'nominal'}
          onClick={() => setDollarMode('nominal')}
        >
          Nominal
        </Button>
        <Button
          variant={dollarMode === 'real' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={dollarMode === 'real'}
          onClick={() => setDollarMode('real')}
        >
          Real
        </Button>
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Projection detail level">
        <Label className="text-sm">Detail:</Label>
        {levels.map(({ value, label }) => (
          <Button
            key={value}
            variant={detailLevel === value ? 'default' : 'outline'}
            size="sm"
            aria-pressed={detailLevel === value}
            onClick={() => onDetailLevelChange(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
