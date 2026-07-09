import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import EntityCard from './EntityCard';
import SectionEntryGate from './SectionEntryGate';
import AccountForm from './forms/AccountForm';
import HoldingForm from './forms/HoldingForm';
import PropertyForm from './forms/PropertyForm';
import VehicleForm from './forms/VehicleForm';
import HousingPaymentForm from './forms/HousingPaymentForm';
import VehicleLeaseForm from './forms/VehicleLeaseForm';
import EquityGrantForm, {
  DEFAULT_EQUITY_GRANT,
} from '@/components/forms/EquityGrantForm';
import { useAccountsStore } from '@/stores/accounts-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { SECTIONS, type SectionStatus } from './sections';

type ActiveDialog =
  | null
  | 'accounts'
  | 'holdings'
  | 'properties'
  | 'housing_payments'
  | 'vehicles'
  | 'vehicle_leases'
  | 'equity_grants';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

export default function Section2_WhatYouOwn({ status, onSetStatus }: Props) {
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const housingPayments = useHousingPaymentsStore((s) => s.housingPayments);
  const loadHousingPayments = useHousingPaymentsStore((s) => s.load);
  const vehicleLeases = useVehicleLeasesStore((s) => s.vehicleLeases);
  const loadVehicleLeases = useVehicleLeasesStore((s) => s.load);
  const equityGrants = useEquityGrantsStore((s) => s.equityGrants);
  const loadEquityGrants = useEquityGrantsStore((s) => s.load);
  const createEquityGrant = useEquityGrantsStore((s) => s.create);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const [dialog, setDialog] = useState<ActiveDialog>(null);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    void loadHoldings();
  }, [loadHoldings]);
  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);
  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);
  useEffect(() => {
    void loadHousingPayments();
  }, [loadHousingPayments]);
  useEffect(() => {
    void loadVehicleLeases();
  }, [loadVehicleLeases]);
  useEffect(() => {
    void loadEquityGrants();
  }, [loadEquityGrants]);
  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);

  const meta = SECTIONS[1];

  // Holdings import resolves CSV rows to existing accounts by name; with no
  // accounts there is nothing to match, so gate the import (W7).
  const noAccountsReason =
    accounts.length === 0
      ? 'Add an account first — imports match rows to existing accounts by name.'
      : undefined;

  if (status === 'pending' || status === 'skipped') {
    return (
      <SectionEntryGate
        title={meta.introTitle}
        body={meta.introBody}
        onStart={() => onSetStatus('in_progress')}
        onSkip={() => onSetStatus('skipped')}
        wasSkipped={status === 'skipped'}
      />
    );
  }

  return (
    <div className="space-y-4">
      <EntityCard
        title="Accounts"
        description="Checking, savings, brokerage, 401k, IRA, HSA, 529, etc."
        count={accounts.length}
        onAddManual={() => setDialog('accounts')}
        importEnabled
        importTrigger={<ImportCsvButton entity="account" />}
      />
      <EntityCard
        title="Holdings"
        description="Stocks, ETFs, mutual funds inside your accounts."
        count={holdings.length}
        onAddManual={() => setDialog('holdings')}
        importEnabled
        importTrigger={<ImportCsvButton entity="holding" />}
        importDisabledReason={noAccountsReason}
      />
      <EntityCard
        title="Properties"
        description="Real estate you own."
        count={properties.length}
        onAddManual={() => setDialog('properties')}
        importEnabled
        importTrigger={<ImportCsvButton entity="property" />}
      />
      <EntityCard
        title="Rent / housing payment"
        description="If you rent your home — recurring monthly $."
        count={housingPayments.length}
        onAddManual={() => setDialog('housing_payments')}
        importEnabled={false}
      />
      <EntityCard
        title="Vehicles"
        description="Cars, motorcycles, boats, RVs."
        count={vehicles.length}
        onAddManual={() => setDialog('vehicles')}
        importEnabled
        importTrigger={<ImportCsvButton entity="vehicle" />}
      />
      <EntityCard
        title="Vehicle lease"
        description="If you lease a vehicle — recurring monthly $."
        count={vehicleLeases.length}
        onAddManual={() => setDialog('vehicle_leases')}
        importEnabled={false}
      />
      <EntityCard
        title="Equity grants"
        description="RSUs, stock options with vesting schedules."
        count={equityGrants.length}
        onAddManual={() => setDialog('equity_grants')}
        importEnabled
        importTrigger={<ImportCsvButton entity="equity_grant" />}
      />

      <Dialog
        open={dialog === 'accounts'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add an account</DialogTitle>
            <DialogDescription className="sr-only">
              Add a cash, brokerage, or retirement account to track.
            </DialogDescription>
          </DialogHeader>
          <AccountForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'holdings'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a holding</DialogTitle>
            <DialogDescription className="sr-only">
              Add a ticker position held inside one of your accounts.
            </DialogDescription>
          </DialogHeader>
          <HoldingForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'properties'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a property</DialogTitle>
            <DialogDescription className="sr-only">
              Add a property with its purchase details and estimated value.
            </DialogDescription>
          </DialogHeader>
          <PropertyForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'housing_payments'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add rent / housing payment</DialogTitle>
            <DialogDescription className="sr-only">
              Add a recurring rent or housing payment.
            </DialogDescription>
          </DialogHeader>
          <HousingPaymentForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'vehicles'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
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
      <Dialog
        open={dialog === 'vehicle_leases'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
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
      <Dialog
        open={dialog === 'equity_grants'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add an equity grant</DialogTitle>
            <DialogDescription className="sr-only">
              Add an equity grant with its vesting schedule.
            </DialogDescription>
          </DialogHeader>
          <EquityGrantForm
            initial={DEFAULT_EQUITY_GRANT}
            persons={persons.map((p) => ({ id: p.id!, name: p.name }))}
            onSubmit={async (values) => {
              await createEquityGrant(values);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
            submitLabel="Add Grant"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
