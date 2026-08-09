import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import EntityCard from '@/pages/setup/EntityCard';
import VehicleForm from '@/pages/setup/forms/VehicleForm';
import VehicleLeaseForm from '@/pages/setup/forms/VehicleLeaseForm';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** vehicles_gate — the Section 2 vehicles + lease cards inline;
 *  entityCount = vehicles + leases. */
export default function VehiclesGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, entityCount } = useGateAnswer(
    'vehicles_gate', ctx, submitRef, onDirtyChange,
  );
  const [dialog, setDialog] = useState<null | 'vehicles' | 'vehicle_leases'>(null);
  const cfg = GATE_CONFIG.vehicles_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-vehicles"
        question={cfg.question}
        consequence={cfg.consequence}
        entityCount={entityCount}
        nounSingular={cfg.nounSingular}
        nounPlural={cfg.nounPlural}
        storedStatus={storedStatus}
        answer={answer}
        onAnswer={setAnswer}
      >
        <div className="space-y-4">
          <EntityCard
            title="Vehicles"
            description="Cars, motorcycles, boats, RVs."
            count={ctx.vehicles.length}
            onAddManual={() => setDialog('vehicles')}
            importEnabled
            importTrigger={<ImportCsvButton entity="vehicle" />}
            items={ctx.vehicles.map((v, i) => ({ key: v.id ?? i, label: v.name }))}
            manageHref="/vehicles"
            manageLabel="Manage on Vehicles page"
          />
          <EntityCard
            title="Vehicle lease"
            description="If you lease a vehicle — recurring monthly $."
            count={ctx.vehicleLeases.length}
            onAddManual={() => setDialog('vehicle_leases')}
            importEnabled={false}
            items={ctx.vehicleLeases.map((vl, i) => ({ key: vl.id ?? i, label: vl.name }))}
            manageHref="/vehicles"
            manageLabel="Manage on Vehicles page"
          />
        </div>
      </GateQuestion>
      <Dialog open={dialog === 'vehicles'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a vehicle</DialogTitle>
            <DialogDescription className="sr-only">
              Add a vehicle with its purchase details and estimated value.
            </DialogDescription>
          </DialogHeader>
          <VehicleForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === 'vehicle_leases'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add vehicle lease</DialogTitle>
            <DialogDescription className="sr-only">
              Add a recurring vehicle lease payment.
            </DialogDescription>
          </DialogHeader>
          <VehicleLeaseForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
