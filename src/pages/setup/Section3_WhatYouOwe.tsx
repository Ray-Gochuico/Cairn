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
import LoanForm from './forms/LoanForm';
import { useLoansStore } from '@/stores/loans-store';
import { SECTIONS, type SectionStatus } from './sections';

type ActiveDialog = null | 'loans';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

export default function Section3_WhatYouOwe({ status, onSetStatus }: Props) {
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const [dialog, setDialog] = useState<ActiveDialog>(null);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  const meta = SECTIONS[2];

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
