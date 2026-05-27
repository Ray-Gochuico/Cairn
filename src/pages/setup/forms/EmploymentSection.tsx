import { useEffect, useState } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import type { EmploymentType, Person } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  /** Fires after each successful per-person save. */
  onSaved?: () => void;
}

interface PersonDraft {
  // Required-numeric fields are stored as strings here so an empty input
  // stays empty (instead of silently coercing to 0). The save handler
  // converts back to numbers and validates against the schema.
  employmentType: EmploymentType;
  annualSalaryPretax: string;
  hourlyRate: number | null;
  regularHoursPerWeek: string;
  otThresholdHoursPerWeek: number | null;
}

function personToDraft(p: Person): PersonDraft {
  return {
    employmentType: p.employmentType,
    annualSalaryPretax: String(p.annualSalaryPretax),
    hourlyRate: p.hourlyRate,
    regularHoursPerWeek: String(p.regularHoursPerWeek),
    otThresholdHoursPerWeek: p.otThresholdHoursPerWeek,
  };
}

function emptyToNullNumber(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-person employment editor. Mounted inside the Employment Dialog of
 * the wizard's Section 1. Mirrors the conditional-field rules of the
 * canonical PersonForm:
 *   - HOURLY: hourly fields only (annual salary hidden)
 *   - SALARY_NO_OT: annual salary only
 *   - SALARY_WITH_OT: both annual salary AND hourly fields
 *
 * Save is per-row and fires onSaved after each successful update so the
 * card count refreshes.
 */
export default function EmploymentSection({ onSaved }: Props) {
  const { persons, load, update } = usePersonsStore();
  const [drafts, setDrafts] = useState<Record<number, PersonDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [errorById, setErrorById] = useState<Record<number, string | null>>(
    {},
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const p of persons) {
        if (p.id != null && next[p.id] === undefined) {
          next[p.id] = personToDraft(p);
        }
      }
      return next;
    });
  }, [persons]);

  const setDraft = (id: number, patch: Partial<PersonDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  const handleSave = async (id: number) => {
    const draft = drafts[id];
    if (!draft) return;
    if (
      draft.annualSalaryPretax.trim() === '' ||
      draft.regularHoursPerWeek.trim() === ''
    ) {
      setErrorById((prev) => ({
        ...prev,
        [id]: "Couldn't save — please check the values.",
      }));
      return;
    }
    const annualSalaryPretax = Number(draft.annualSalaryPretax);
    const regularHoursPerWeek = Number(draft.regularHoursPerWeek);
    setSavingId(id);
    setErrorById((prev) => ({ ...prev, [id]: null }));
    try {
      await update(id, {
        employmentType: draft.employmentType,
        annualSalaryPretax,
        hourlyRate: draft.hourlyRate,
        regularHoursPerWeek,
        otThresholdHoursPerWeek: draft.otThresholdHoursPerWeek,
      });
      onSaved?.();
    } catch {
      setErrorById((prev) => ({
        ...prev,
        [id]: "Couldn't save — please check the values.",
      }));
    } finally {
      setSavingId(null);
    }
  };

  if (persons.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Add at least one person first (Persons card above).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {persons.map((p) => {
        const id = p.id!;
        const draft = drafts[id] ?? personToDraft(p);
        const showHourlyFields = draft.employmentType !== 'SALARY_NO_OT';
        const showAnnualSalary = draft.employmentType !== 'HOURLY';
        const isSaving = savingId === id;
        const labelId = `employmentType-${id}`;
        const saveError = errorById[id] ?? null;

        return (
          <Card key={id} data-testid={`employment-card-${id}`}>
            <CardHeader>
              <CardTitle className="text-base">{p.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor={labelId}>Employment type</Label>
                <select
                  id={labelId}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={draft.employmentType}
                  onChange={(e) =>
                    setDraft(id, {
                      employmentType: e.target.value as EmploymentType,
                    })
                  }
                >
                  <option value="HOURLY">Hourly</option>
                  <option value="SALARY_NO_OT">Salaried — no overtime</option>
                  <option value="SALARY_WITH_OT">
                    Salaried with overtime
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {showAnnualSalary && (
                  <div>
                    <Label htmlFor={`annualSalaryPretax-${id}`}>
                      Annual salary (pre-tax)
                    </Label>
                    <Input
                      id={`annualSalaryPretax-${id}`}
                      type="number"
                      step="any"
                      value={draft.annualSalaryPretax}
                      onChange={(e) =>
                        setDraft(id, { annualSalaryPretax: e.target.value })
                      }
                    />
                  </div>
                )}
                {showHourlyFields && (
                  <>
                    <div>
                      <Label htmlFor={`hourlyRate-${id}`}>Hourly rate</Label>
                      <Input
                        id={`hourlyRate-${id}`}
                        type="number"
                        step="any"
                        value={draft.hourlyRate ?? ''}
                        onChange={(e) =>
                          setDraft(id, {
                            hourlyRate: emptyToNullNumber(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`regularHoursPerWeek-${id}`}>
                        Regular hours / week
                      </Label>
                      <Input
                        id={`regularHoursPerWeek-${id}`}
                        type="number"
                        step="any"
                        value={draft.regularHoursPerWeek}
                        onChange={(e) =>
                          setDraft(id, {
                            regularHoursPerWeek: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`otThresholdHoursPerWeek-${id}`}>
                        OT threshold (hrs / week)
                      </Label>
                      <Input
                        id={`otThresholdHoursPerWeek-${id}`}
                        type="number"
                        step="any"
                        value={draft.otThresholdHoursPerWeek ?? ''}
                        onChange={(e) =>
                          setDraft(id, {
                            otThresholdHoursPerWeek: emptyToNullNumber(
                              e.target.value,
                            ),
                          })
                        }
                      />
                    </div>
                  </>
                )}
              </div>

              {saveError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {saveError}
                </div>
              )}

              <div className="flex justify-end items-center gap-3">
                <span
                  className="text-sm text-muted-foreground transition-opacity duration-200"
                  style={{ opacity: isSaving ? 1 : 0 }}
                  aria-live="polite"
                >
                  Saving…
                </span>
                <Button
                  type="button"
                  onClick={() => handleSave(id)}
                  disabled={isSaving}
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
