import { useEffect, useState } from 'react';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { LoanType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PropertyForm, {
  DEFAULT_PROPERTY,
  PROPERTY_TYPE_LABELS,
} from '@/components/forms/PropertyForm';
import VehicleForm, { DEFAULT_VEHICLE } from '@/components/forms/VehicleForm';

interface Props {
  onComplete: () => void;
}

type SubForm = 'none' | 'property' | 'vehicle';

/**
 * Setup wizard Step 7 — Property & Vehicles combined. Two entity types
 * sharing one step keeps the wizard at 8 steps (matches the spec) while
 * giving the user a single visual context for "things you own that
 * aren't financial accounts." Inline-add forms open one at a time.
 */
export default function Step7PropertyVehicles({ onComplete }: Props) {
  const {
    properties,
    load: loadProperties,
    create: createProperty,
    remove: removeProperty,
  } = usePropertiesStore();
  const {
    vehicles,
    load: loadVehicles,
    create: createVehicle,
    remove: removeVehicle,
  } = useVehiclesStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { loans, load: loadLoans } = useLoansStore();
  const [showForm, setShowForm] = useState<SubForm>('none');

  useEffect(() => {
    loadProperties();
    loadVehicles();
    loadPersons();
    loadLoans();
  }, [loadProperties, loadVehicles, loadPersons, loadLoans]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const mortgageLoanOptions = loans
    .filter((l) => l.type === LoanType.MORTGAGE)
    .map((l) => ({ id: l.id!, name: l.name }));
  const autoLoanOptions = loans
    .filter((l) => l.type === LoanType.AUTO)
    .map((l) => ({ id: l.id!, name: l.name }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Property &amp; Vehicles</h2>
        <p className="text-sm text-muted-foreground">
          Homes, rentals, land, cars, motorcycles, boats — any non-financial asset you want to track.
        </p>
      </div>

      {(properties.length > 0 || vehicles.length > 0) && (
        <div className="space-y-2">
          {properties.map((p) => (
            <Card key={`property-${p.id}`}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Property · {PROPERTY_TYPE_LABELS[p.type]}
                    {p.currentEstimatedValue != null
                      ? ` · $${p.currentEstimatedValue.toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => removeProperty(p.id!)}>
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
          {vehicles.map((v) => (
            <Card key={`vehicle-${v.id}`}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Vehicle · {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'No year/make/model'}
                    {v.currentEstimatedValue != null
                      ? ` · $${v.currentEstimatedValue.toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => removeVehicle(v.id!)}>
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm === 'property' && (
        <PropertyForm
          initial={DEFAULT_PROPERTY}
          persons={personOptions}
          mortgageLoans={mortgageLoanOptions}
          onSubmit={async (v) => {
            await createProperty(v);
            setShowForm('none');
          }}
          onCancel={() => setShowForm('none')}
          submitLabel="Add Property"
        />
      )}

      {showForm === 'vehicle' && (
        <VehicleForm
          initial={DEFAULT_VEHICLE}
          persons={personOptions}
          autoLoans={autoLoanOptions}
          onSubmit={async (v) => {
            await createVehicle(v);
            setShowForm('none');
          }}
          onCancel={() => setShowForm('none')}
          submitLabel="Add Vehicle"
        />
      )}

      {showForm === 'none' && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowForm('property')}>
            Add a property
          </Button>
          <Button variant="outline" onClick={() => setShowForm('vehicle')}>
            Add a vehicle
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={onComplete}>Continue</Button>
        {properties.length === 0 && vehicles.length === 0 && (
          <Button type="button" variant="ghost" onClick={onComplete}>
            Skip — no property or vehicles
          </Button>
        )}
      </div>
    </div>
  );
}
