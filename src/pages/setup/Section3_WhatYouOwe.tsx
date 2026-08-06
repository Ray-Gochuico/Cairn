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
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import LoanForm from './forms/LoanForm';
import { useLoansStore } from '@/stores/loans-store';
import { SECTIONS, type SectionStatus } from './sections';

type ActiveDialog = null | 'loans';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
  /** Wave C (C2): store-derived truth from SectionLayout — ≥1 saved entity. */
  hasData: boolean;
  /** Wave C (C2): SectionLayout's latched load gate — gate copy may render. */
  settled: boolean;
}

export default function Section3_WhatYouOwe({ status, onSetStatus, hasData, settled }: Props) {
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const [dialog, setDialog] = useState<ActiveDialog>(null);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  const meta = SECTIONS[2];

  // Wave C (C2, owner constraint 1): the entry gate is an EMPTY STATE — it
  // renders only when the section is truly empty (DC3: including skipped-
  // with-data), and never before the stores settle (the W10 F6 false-empty
  // class). Saved data always renders the entity cards.
  if (!hasData && (status === 'pending' || status === 'skipped')) {
    if (!settled) return <TabLoadingSkeleton />;
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
      {meta.intro && (
        <p
          data-testid="section3-intro"
          className="text-sm text-muted-foreground"
        >
          {meta.intro}
        </p>
      )}
      <EntityCard
        title="Loans"
        description="Mortgages, auto, student, personal, credit cards, etc."
        count={loans.length}
        onAddManual={() => setDialog('loans')}
        importEnabled
        importTrigger={<ImportCsvButton entity="loan" />}
        items={loans.map((l, i) => ({ key: l.id ?? i, label: l.name }))}
        manageHref="/loans"
        manageLabel="Manage on Loans page"
      />

      <Dialog
        open={dialog === 'loans'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a loan</DialogTitle>
            <DialogDescription className="sr-only">
              Add a loan with its balance, rate, and payment schedule.
            </DialogDescription>
          </DialogHeader>
          <LoanForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
