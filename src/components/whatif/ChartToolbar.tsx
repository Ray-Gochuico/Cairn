import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useScenariosStore } from '@/stores/scenarios-store';

export default function ChartToolbar() {
  const horizonMonths     = useScenariosStore((s) => s.horizonMonths);
  const dollarMode        = useScenariosStore((s) => s.dollarMode);
  const setHorizonMonths  = useScenariosStore((s) => s.setHorizonMonths);
  const setDollarMode     = useScenariosStore((s) => s.setDollarMode);

  const years = Math.round(horizonMonths / 12);

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
    </div>
  );
}
