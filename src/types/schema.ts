import { z } from 'zod';
import { FilingStatus, DependentType } from './enums';

const today = () => new Date().toISOString().slice(0, 10);

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

const pastOrTodayDate = isoDateString.refine(
  (d) => d <= today(),
  { message: 'Date cannot be in the future' }
);

export const GrowthScenarioSchema = z.object({
  label: z.string().min(1).max(50),
  rate: z.number().min(0).max(1),
});
export type GrowthScenario = z.infer<typeof GrowthScenarioSchema>;

export const HouseholdSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().max(100).nullable().optional(),
  filingStatus: z.nativeEnum(FilingStatus),
  state: z.string().length(2, 'Use 2-letter state code'),
  city: z.string().max(100).nullable(),
  monthlyExpenseBaseline: z.number().nonnegative(),
  withdrawalRate: z.number().min(0).max(1),
  inflationAssumption: z.number().min(0).max(1),
  growthScenarios: z.array(GrowthScenarioSchema),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const PersonSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  dateOfBirth: pastOrTodayDate,
  targetRetirementAge: z.number().int().min(30).max(90),
  annualSalaryPretax: z.number().nonnegative(),
  expectedBonus: z.number().nonnegative(),
  pretax401kPct: z.number().min(0).max(1),
  healthInsuranceMonthlyPremium: z.number().nonnegative(),
  dependentCareFsaMonthly: z.number().nonnegative(),
  hsaMonthlyContribution: z.number().nonnegative(),
  hsaEligible: z.boolean(),
});
export type Person = z.infer<typeof PersonSchema>;

export const DependentSchema = z.object({
  id: z.number().int().positive().optional(),
  householdId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  dateOfBirth: pastOrTodayDate,
  type: z.nativeEnum(DependentType),
});
export type Dependent = z.infer<typeof DependentSchema>;
