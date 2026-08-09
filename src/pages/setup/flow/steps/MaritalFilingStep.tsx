import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DatePicker from '@/components/ui/DatePicker';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { FieldError } from '@/components/forms/form-errors';
import { FILING_STATUS_LABELS } from '@/lib/filing-status-labels';
import { FilingStatus } from '@/types/enums';
import { resolveBindings } from '@/domain/setup-flow/engine';
import {
  EMPTY_MARITAL_VALUES,
  maritalConflict,
  prefillMaritalFiling,
  saveConflictFiling,
  saveMaritalFiling,
  type MaritalFilingValues,
} from '@/domain/setup-flow/steps/part1';
import type { StepComponentProps } from '../step-props';

/** CW-13 — the 4-way escape-hatch select, options byte-equal to
 *  HouseholdForm's. The MFJ/MFS/HOH glossary TermTooltips attach as a
 *  definitions line under the select (a TermTooltip renders a <button>,
 *  which is invalid and keyboard-unreachable inside a Radix option). */
function FilingStatusSelect({
  value,
  onChange,
}: {
  value: FilingStatus | null;
  onChange: (v: FilingStatus) => void;
}) {
  return (
    <div>
      <Label htmlFor="flow-filing-status">Filing status</Label>
      <Select value={value ?? undefined} onValueChange={(v) => onChange(v as FilingStatus)}>
        <SelectTrigger id="flow-filing-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FilingStatus.SINGLE}>Single</SelectItem>
          <SelectItem value={FilingStatus.MFJ}>Married Filing Jointly</SelectItem>
          <SelectItem value={FilingStatus.MFS}>Married Filing Separately</SelectItem>
          <SelectItem value={FilingStatus.HOH}>Head of Household</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground mt-1">
        <TermTooltip term="MFJ">Married Filing Jointly</TermTooltip>
        {' · '}
        <TermTooltip term="MFS">Married Filing Separately</TermTooltip>
        {' · '}
        <TermTooltip term="HOH">Head of Household</TermTooltip>
      </p>
    </div>
  );
}

const HONESTY_LINE =
  "This sets which IRS brackets and caps the estimates use — it doesn't file anything. You can change it any time in Household.";

/** 1b — CW-11…CW-19. Writes household.filingStatus ONLY (D-WF15/D-WF17). */
export default function MaritalFilingStep({ ctx, asked, onDirtyChange, submitRef }: StepComponentProps) {
  const conflict = maritalConflict(ctx);
  const { partner } = resolveBindings(ctx);
  const [seed] = useState<MaritalFilingValues>(() =>
    asked && !conflict ? prefillMaritalFiling(ctx) : EMPTY_MARITAL_VALUES,
  );
  const [values, setValues] = useState<MaritalFilingValues>(seed);
  const [conflictStatus, setConflictStatus] = useState<FilingStatus | null>(null);
  const [validationError, setValidationError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const patch = (p: Partial<MaritalFilingValues>) => setValues((v) => ({ ...v, ...p }));

  useEffect(() => {
    if (conflict) {
      onDirtyChange(conflictStatus != null);
    } else {
      onDirtyChange(JSON.stringify(values) !== JSON.stringify(seed));
    }
  }, [values, seed, conflict, conflictStatus, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      try {
        setSaveError(false);
        const r = conflict
          ? await saveConflictFiling(conflictStatus)
          : await saveMaritalFiling(values, ctx);
        setValidationError(!r.ok);
        return r;
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  if (conflict) {
    const label =
      FILING_STATUS_LABELS[ctx.household?.filingStatus ?? ''] ?? ctx.household?.filingStatus ?? '';
    return (
      <div className="space-y-3">
        <p className="text-sm" role="note">
          Your saved filing status ({label}) doesn't match the number of people in this
          household. Review both under{' '}
          <Link to="/inputs/household" className="underline">
            Inputs → Household
          </Link>{' '}
          and{' '}
          <Link to="/inputs/persons" className="underline">
            Inputs → People
          </Link>
          .
        </p>
        <FilingStatusSelect value={conflictStatus} onChange={setConflictStatus} />
        {validationError && (
          <FieldError id="flow-filing-conflict-error" message="Filing status is required." />
        )}
        <p className="text-sm text-muted-foreground">{HONESTY_LINE}</p>
        {saveError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground"
          >
            Couldn't save — please check the values.
          </div>
        )}
      </div>
    );
  }

  const prefillSaidYes = seed.married === 'yes';

  return (
    <div className="space-y-3">
      <p className="text-base font-medium" id="flow-married-q">
        Are you married?
      </p>
      <RadioGroup
        aria-labelledby="flow-married-q"
        value={values.married ?? ''}
        onValueChange={(v) => patch({ married: v as 'yes' | 'no' })}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="yes" id="flow-married-yes" />
          <Label htmlFor="flow-married-yes">Yes</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="no" id="flow-married-no" />
          <Label htmlFor="flow-married-no">No</Label>
        </div>
      </RadioGroup>

      {values.married === 'yes' && (
        <div className="space-y-3">
          <p className="text-base font-medium" id="flow-filing-q">
            How do you file taxes?
          </p>
          <RadioGroup
            aria-labelledby="flow-filing-q"
            value={values.filing ?? ''}
            onValueChange={(v) =>
              patch({ filing: v as 'jointly' | 'separately' | 'complicated' })
            }
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="jointly" id="flow-filing-jointly" />
              <Label htmlFor="flow-filing-jointly">Jointly</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="separately" id="flow-filing-separately" />
              <Label htmlFor="flow-filing-separately">Separately</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="complicated" id="flow-filing-complicated" />
              <Label htmlFor="flow-filing-complicated">
                It's more complicated / I'm not sure
              </Label>
            </div>
          </RadioGroup>
          {values.filing === 'complicated' && (
            <FilingStatusSelect
              value={values.complicatedStatus}
              onChange={(v) => patch({ complicatedStatus: v })}
            />
          )}
          {partner != null ? (
            <p className="text-sm text-muted-foreground" role="note">
              {partner.name} is already in your household — the work and pay questions will
              use their row.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="flow-partner-name">Your partner's name</Label>
                <Input
                  id="flow-partner-name"
                  value={values.partnerName}
                  onChange={(e) => patch({ partnerName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="flow-partner-dob">Your partner's date of birth</Label>
                <DatePicker
                  id="flow-partner-dob"
                  label="Your partner's date of birth"
                  value={values.partnerDob}
                  onChange={(v) => patch({ partnerDob: v })}
                  maxYear={new Date().getFullYear() - 16}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {values.married === 'no' && (
        <div className="space-y-3">
          <RadioGroup
            aria-labelledby="flow-married-q"
            value={values.noChoice ?? ''}
            onValueChange={(v) => patch({ noChoice: v as 'single' | 'hoh' })}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="single" id="flow-no-single" />
              <Label htmlFor="flow-no-single">Single</Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="hoh" id="flow-no-hoh" className="mt-0.5" />
              <div>
                <Label htmlFor="flow-no-hoh">
                  I pay more than half the cost of a home for a qualifying dependent
                </Label>
                <p className="text-sm text-muted-foreground">
                  Files as <TermTooltip term="HOH">Head of household</TermTooltip>.
                </p>
              </div>
            </div>
          </RadioGroup>
          {prefillSaidYes && partner != null && (
            <p className="text-sm text-muted-foreground" role="note">
              {partner.name} is still in your household — remove them under Inputs → People
              if needed.
            </p>
          )}
        </div>
      )}

      {validationError && (
        <FieldError id="flow-marital-error" message="An answer is required." />
      )}
      <p className="text-sm text-muted-foreground">{HONESTY_LINE}</p>
      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground"
        >
          Couldn't save — please check the values.
        </div>
      )}
    </div>
  );
}
