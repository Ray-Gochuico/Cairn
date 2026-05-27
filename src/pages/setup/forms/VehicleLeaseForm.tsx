import { useEffect } from 'react';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { usePersonsStore } from '@/stores/persons-store';
import VehicleLeaseFormImpl, {
  DEFAULT_VEHICLE_LEASE,
} from '@/components/forms/VehicleLeaseForm';

interface Props {
  onSaved?: () => void;
}

/** Wizard wrapper around the canonical VehicleLeaseForm. */
export default function VehicleLeaseForm({ onSaved }: Props) {
  const create = useVehicleLeasesStore((s) => s.create);
  const { persons, load: loadPersons } = usePersonsStore();

  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);

  return (
    <VehicleLeaseFormImpl
      initial={DEFAULT_VEHICLE_LEASE}
      persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
      onSubmit={async (values) => {
        await create(values);
        onSaved?.();
      }}
      onCancel={() => onSaved?.()}
      submitLabel="Add Lease"
    />
  );
}
