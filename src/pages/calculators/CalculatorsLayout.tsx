import { PaycheckCard } from './PaycheckCard';
import { BonusTaxCard } from './BonusTaxCard';
import { CommissionTaxCard } from './CommissionTaxCard';
import { OvertimeCard } from './OvertimeCard';
import { usePersonsStore } from '@/stores/persons-store';

export default function CalculatorsLayout() {
  const { persons } = usePersonsStore();
  const showOvertime = persons.some(
    (p) => p.employmentType === 'HOURLY' || p.employmentType === 'SALARY_WITH_OT',
  );

  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Calculators</h1>
      <p className="text-sm text-muted-foreground">
        All calculators run on your current Inputs data. Use "Override" on any card to try a what-if.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
        <PaycheckCard />
        <BonusTaxCard />
        <CommissionTaxCard />
        {showOvertime && <OvertimeCard />}
      </div>
    </div>
  );
}
