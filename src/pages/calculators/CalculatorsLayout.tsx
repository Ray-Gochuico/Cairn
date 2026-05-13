import { BonusTaxCard } from './BonusTaxCard';

export default function CalculatorsLayout() {
  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Calculators</h1>
      <p className="text-sm text-muted-foreground">
        All calculators run on your current Inputs data. Use "Override" on any card to try a what-if.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
        <BonusTaxCard />
      </div>
    </div>
  );
}
