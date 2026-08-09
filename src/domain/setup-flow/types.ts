import type {
  Account, Dependent, EquityGrant, Goal, Household, HousingPayment,
  Loan, Person, Property, Transaction, Vehicle, VehicleLease,
} from '@/types/schema';
import type { FlowPart, Role, SetupProgressV2, StepId } from '@/lib/setup-progress';

/** Snapshot the engine reads. Assembled by the shell each render from the
 *  hydrated stores; every engine function is pure over it. `todayIso` is the
 *  ONLY clock (date purity — the shell computes it once). */
export interface FlowCtx {
  household: Household | null;
  persons: Person[];
  dependents: Dependent[];
  accounts: Account[];
  properties: Property[];
  housingPayments: HousingPayment[];
  vehicles: Vehicle[];
  vehicleLeases: VehicleLease[];
  equityGrants: EquityGrant[];
  loans: Loan[];
  transactions: Transaction[];
  goals: Goal[];
  progress: SetupProgressV2;
  todayIso: string;
}

export interface StepInstance {
  id: StepId;
  role?: Role;
  /** Progress-record key: stepId or `${stepId}:${role}`. */
  key: string;
  part: FlowPart;
}

export type ProgressUpdate = (p: SetupProgressV2) => SetupProgressV2;
/** Save mappers return ok:false on validation failure (shell stays put) or
 *  ok:true with an optional progress transform (drafts/bindings). Gate step
 *  components additionally report the user's yes/no so the SHELL maps it to a
 *  status per D-WF11 (yes+entities → completed; yes+zero → in_progress;
 *  no → skipped) — steps never write statuses themselves. */
export type StepSaveResult =
  | { ok: true; progressUpdate?: ProgressUpdate; gateAnswer?: 'yes' | 'no' }
  | { ok: false };
