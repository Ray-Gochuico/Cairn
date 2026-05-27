import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import EntityCard from './EntityCard';
import SectionEntryGate from './SectionEntryGate';
import GoalForm from './forms/GoalForm';
import ValueHistorySection from '@/components/inputs/ValueHistorySection';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useGoalsStore } from '@/stores/goals-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import {
  AssetSnapshotOwnerType,
  ContributionSource,
  SnapshotSource,
} from '@/types/enums';
import { SECTIONS, type SectionStatus } from './sections';

type ActiveDialog =
  | null
  | 'snapshots'
  | 'asset_snapshots'
  | 'contributions'
  | 'goals';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

export default function Section4_History({ status, onSetStatus }: Props) {
  const navigate = useNavigate();

  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const upsertSnapshot = useSnapshotsStore((s) => s.upsert);
  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);
  const createContribution = useContributionsStore((s) => s.create);
  const assetSnapshots = useAssetValueSnapshotsStore(
    (s) => s.assetValueSnapshots,
  );
  const loadAssetSnapshots = useAssetValueSnapshotsStore((s) => s.load);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const goals = useGoalsStore((s) => s.goals);
  const loadGoals = useGoalsStore((s) => s.load);
  const [dialog, setDialog] = useState<ActiveDialog>(null);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);
  useEffect(() => {
    void loadContributions();
  }, [loadContributions]);
  useEffect(() => {
    void loadAssetSnapshots();
  }, [loadAssetSnapshots]);
  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);
  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);
  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  const meta = SECTIONS[3];

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
        title="Account snapshots"
        description="Historical balances per account."
        count={snapshots.length}
        onAddManual={() => setDialog('snapshots')}
      />
      <EntityCard
        title="Property / vehicle values"
        description="Historical estimated values."
        count={assetSnapshots.length}
        onAddManual={() => setDialog('asset_snapshots')}
      />
      <EntityCard
        title="Contributions"
        description="Past contributions per account."
        count={contributions.length}
        onAddManual={() => setDialog('contributions')}
      />
      <EntityCard
        title="Transactions"
        description="Past transactions (CSV or PDF statements). PDF statements and transaction CSVs are imported on the Spending page."
        count={0}
        onAddManual={() => navigate('/spending')}
      />
      <EntityCard
        title="Goals"
        description="Retirement, education, home, custom."
        count={goals.length}
        onAddManual={() => setDialog('goals')}
      />

      <Dialog
        open={dialog === 'snapshots'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add account snapshot</DialogTitle>
          </DialogHeader>
          <AccountSnapshotInlineForm
            accounts={accounts}
            onSubmit={async (snap) => {
              await upsertSnapshot(snap);
              setDialog(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'asset_snapshots'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add property / vehicle value snapshot</DialogTitle>
          </DialogHeader>
          <AssetSnapshotsInlineForm
            properties={properties}
            vehicles={vehicles}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'contributions'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add contribution</DialogTitle>
          </DialogHeader>
          <ContributionInlineForm
            accounts={accounts}
            onSubmit={async (c) => {
              await createContribution(c);
              setDialog(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'goals'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a goal</DialogTitle>
          </DialogHeader>
          <GoalForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -- Inline forms ----------------------------------------------------------

interface AccountSnapshotInlineFormProps {
  accounts: Array<{ id?: number | null; name: string }>;
  onSubmit: (snap: {
    accountId: number;
    snapshotDate: string;
    totalValue: number;
    source: typeof SnapshotSource.MANUAL;
  }) => Promise<void>;
}

function AccountSnapshotInlineForm({
  accounts,
  onSubmit,
}: AccountSnapshotInlineFormProps) {
  const [accountId, setAccountId] = useState<number | null>(
    accounts[0]?.id ?? null,
  );
  const [date, setDate] = useState('');
  const [balance, setBalance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    accountId !== null && date !== '' && balance.trim() !== '' && !submitting;

  if (accounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Add an account first (Section 2 → Accounts). Snapshots are
        per-account.
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit || accountId === null) return;
        setSubmitting(true);
        setError(null);
        try {
          await onSubmit({
            accountId,
            snapshotDate: date,
            totalValue: Number(balance),
            source: SnapshotSource.MANUAL,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <Label htmlFor="snapshot-account">Account</Label>
        <select
          id="snapshot-account"
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={accountId ?? ''}
          onChange={(e) => setAccountId(Number(e.target.value))}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id ?? ''}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="snapshot-date">Snapshot date</Label>
        <DatePicker
          id="snapshot-date"
          value={date}
          onChange={(v) => setDate(v)}
        />
      </div>
      <div>
        <Label htmlFor="snapshot-balance">Total value</Label>
        <Input
          id="snapshot-balance"
          type="number"
          step="any"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          Add snapshot
        </Button>
      </div>
    </form>
  );
}

interface ContributionInlineFormProps {
  accounts: Array<{ id?: number | null; name: string }>;
  onSubmit: (c: {
    accountId: number;
    personId: number | null;
    date: string;
    amount: number;
    source: typeof ContributionSource.MANUAL;
  }) => Promise<void>;
}

function ContributionInlineForm({
  accounts,
  onSubmit,
}: ContributionInlineFormProps) {
  const [accountId, setAccountId] = useState<number | null>(
    accounts[0]?.id ?? null,
  );
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    accountId !== null && date !== '' && amount.trim() !== '' && !submitting;

  if (accounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Add an account first (Section 2 → Accounts). Contributions are
        per-account.
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit || accountId === null) return;
        setSubmitting(true);
        setError(null);
        try {
          await onSubmit({
            accountId,
            personId: null,
            date,
            amount: Number(amount),
            source: ContributionSource.MANUAL,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <Label htmlFor="contribution-account">Account</Label>
        <select
          id="contribution-account"
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={accountId ?? ''}
          onChange={(e) => setAccountId(Number(e.target.value))}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id ?? ''}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="contribution-date">Date</Label>
        <DatePicker
          id="contribution-date"
          value={date}
          onChange={(v) => setDate(v)}
        />
      </div>
      <div>
        <Label htmlFor="contribution-amount">Amount</Label>
        <Input
          id="contribution-amount"
          type="number"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          Add contribution
        </Button>
      </div>
    </form>
  );
}

interface AssetSnapshotsInlineFormProps {
  properties: Array<{ id?: number | null; name: string; currentEstimatedValue: number | null }>;
  vehicles: Array<{ id?: number | null; name: string; currentEstimatedValue: number | null }>;
}

function AssetSnapshotsInlineForm({
  properties,
  vehicles,
}: AssetSnapshotsInlineFormProps) {
  const allOwners = useMemo(
    () => [
      ...properties.map((p) => ({
        key: `PROPERTY-${p.id}`,
        ownerType: AssetSnapshotOwnerType.PROPERTY,
        id: p.id!,
        name: p.name,
        fallbackValue: p.currentEstimatedValue,
      })),
      ...vehicles.map((v) => ({
        key: `VEHICLE-${v.id}`,
        ownerType: AssetSnapshotOwnerType.VEHICLE,
        id: v.id!,
        name: v.name,
        fallbackValue: v.currentEstimatedValue,
      })),
    ],
    [properties, vehicles],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(
    allOwners[0]?.key ?? null,
  );

  if (allOwners.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Add a property or vehicle first (Section 2). Value snapshots are
        per-asset.
      </div>
    );
  }

  const selected = allOwners.find((o) => o.key === selectedKey) ?? allOwners[0];

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="asset-snapshot-owner">Property or vehicle</Label>
        <select
          id="asset-snapshot-owner"
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={selectedKey ?? ''}
          onChange={(e) => setSelectedKey(e.target.value)}
        >
          {allOwners.map((o) => (
            <option key={o.key} value={o.key}>
              {o.ownerType === AssetSnapshotOwnerType.PROPERTY
                ? 'Property: '
                : 'Vehicle: '}
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <ValueHistorySection
        key={selected.key}
        ownerType={selected.ownerType}
        ownerId={selected.id}
        fallbackValue={selected.fallbackValue}
      />
    </div>
  );
}
