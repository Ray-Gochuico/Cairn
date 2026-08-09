import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { fractionToPercent } from '@/lib/percent-fields';
import {
  nameForRole,
  personForRole,
  saveBenefits,
  type BenefitsValues,
} from '@/domain/setup-flow/steps/part2';
import type { StepComponentProps } from '../step-props';

/** 2c — CW-28. Person-scoped copy always (never the household HDHP fact);
 *  entered-fields-only writes (D-WF18); skip handled by the shell (CW-29). */
export default function BenefitsStep({ ctx, role = 'you', asked, onDirtyChange, submitRef }: StepComponentProps) {
  const name = nameForRole(ctx, role);
  const [seed] = useState<BenefitsValues>(() => {
    if (!asked) {
      return { pct401k: null, hsaContributes: null, hsaEligible: false, hsaMonthly: null, premiumMonthly: null };
    }
    const bound = personForRole(ctx, role);
    if (!bound) {
      return { pct401k: null, hsaContributes: null, hsaEligible: false, hsaMonthly: null, premiumMonthly: null };
    }
    return {
      pct401k: bound.pretax401kPct > 0 ? fractionToPercent(bound.pretax401kPct) : null,
      hsaContributes:
        bound.hsaMonthlyContribution > 0 || bound.hsaEligible ? true : null,
      hsaEligible: bound.hsaEligible,
      hsaMonthly: bound.hsaMonthlyContribution || null,
      premiumMonthly: bound.healthInsuranceMonthlyPremium || null,
    };
  });
  const [values, setValues] = useState<BenefitsValues>(seed);
  const [saveError, setSaveError] = useState(false);
  const patch = (p: Partial<BenefitsValues>) => setValues((v) => ({ ...v, ...p }));

  useEffect(() => {
    onDirtyChange(JSON.stringify(values) !== JSON.stringify(seed));
  }, [values, seed, onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      try {
        setSaveError(false);
        return await saveBenefits(role, values, ctx);
      } catch {
        setSaveError(true);
        return { ok: false };
      }
    };
  });

  return (
    <div className="space-y-4">
      <p className="text-base font-medium">Benefits for {name}.</p>

      <div>
        <Label htmlFor="flow-benefits-401k">
          What percent of pay goes into {name}'s 401(k)?
        </Label>
        <div className="relative sm:max-w-xs">
          <Input
            id="flow-benefits-401k"
            type="number"
            step="0.1"
            min={0}
            max={100}
            className="pr-8"
            value={values.pct401k ?? ''}
            onChange={(e) =>
              patch({ pct401k: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
          <span
            aria-hidden="true"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none"
          >
            %
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-base font-medium" id="flow-benefits-hsa-q">
          Does {name} put money into an <TermTooltip term="HSA">HSA</TermTooltip>?
        </p>
        <RadioGroup
          aria-labelledby="flow-benefits-hsa-q"
          value={values.hsaContributes == null ? '' : values.hsaContributes ? 'yes' : 'no'}
          onValueChange={(v) => patch({ hsaContributes: v === 'yes' })}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="yes" id="flow-benefits-hsa-yes" />
            <Label htmlFor="flow-benefits-hsa-yes">Yes</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="no" id="flow-benefits-hsa-no" />
            <Label htmlFor="flow-benefits-hsa-no">No</Label>
          </div>
        </RadioGroup>
        {values.hsaContributes === true && (
          <div className="space-y-2 pl-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.hsaEligible}
                onChange={(e) => patch({ hsaEligible: e.target.checked })}
              />
              <span>
                {name} is on an <TermTooltip term="HSA">HSA</TermTooltip>-qualified health
                plan (<TermTooltip term="HDHP">HDHP</TermTooltip>)
              </span>
            </label>
            <div>
              <Label htmlFor="flow-benefits-hsa-monthly">HSA contribution / month</Label>
              <MoneyInput
                id="flow-benefits-hsa-monthly"
                className="sm:max-w-xs"
                value={values.hsaMonthly}
                onValueChange={(v) => patch({ hsaMonthly: v })}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="flow-benefits-premium">
          What does {name} pay each month for health insurance?
        </Label>
        <MoneyInput
          id="flow-benefits-premium"
          className="sm:max-w-xs"
          value={values.premiumMonthly}
          onValueChange={(v) => patch({ premiumMonthly: v })}
        />
      </div>

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
