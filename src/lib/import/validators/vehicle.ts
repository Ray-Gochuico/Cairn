// src/lib/import/validators/vehicle.ts
import type { Vehicle } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type VehicleResolved = Omit<Vehicle, 'id'>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOOLEAN_TRUE = new Set(['true', '1', 'yes', 'y']);
const BOOLEAN_FALSE = new Set(['false', '0', 'no', 'n', '']);

/**
 * Validate one vehicle import row. The schema has no `type` enum (unlike
 * property — the design spec's column table mentions one but the
 * underlying schema uses year/make/model identifiers instead). We
 * mirror that here: required name + value, optional year/make/model
 * descriptors, optional purchase date/price + owner FK lookup.
 */
export function validateVehicleRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<VehicleResolved> {
  const errors: CellError[] = [];

  const name = (raw.name ?? '').trim();
  if (name.length === 0) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'Name must be ≤ 100 chars.' });
  }

  // current_estimated_value (required ≥ 0)
  let currentEstimatedValue: number | null = null;
  const cevRaw = (raw.current_estimated_value ?? '').trim();
  if (cevRaw.length === 0) {
    errors.push({ field: 'current_estimated_value', message: 'Required.' });
  } else {
    const n = Number(cevRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'current_estimated_value', message: 'Must be a non-negative number.' });
    } else {
      currentEstimatedValue = n;
    }
  }

  // year / make / model (optional)
  let year: number | null = null;
  const yRaw = (raw.year ?? '').trim();
  if (yRaw.length > 0) {
    const n = Number(yRaw);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      errors.push({ field: 'year', message: 'Must be a 4-digit year (1900..2100).' });
    } else {
      year = n;
    }
  }
  const make = (raw.make ?? '').trim() || null;
  const model = (raw.model ?? '').trim() || null;

  // purchase_date (optional ISO)
  let purchaseDate: string | null = null;
  const pd = (raw.purchase_date ?? '').trim();
  if (pd.length > 0) {
    if (!ISO_DATE_RE.test(pd)) {
      errors.push({ field: 'purchase_date', message: 'Use YYYY-MM-DD format.' });
    } else {
      purchaseDate = pd;
    }
  }

  // purchase_price (optional ≥ 0)
  let purchasePrice: number | null = null;
  const ppRaw = (raw.purchase_price ?? '').trim();
  if (ppRaw.length > 0) {
    const n = Number(ppRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'purchase_price', message: 'Must be a non-negative number.' });
    } else {
      purchasePrice = n;
    }
  }

  // owner_person_name (optional FK)
  let ownerPersonId: number | null = null;
  const ownerName = (raw.owner_person_name ?? '').trim();
  if (ownerName.length > 0) {
    const m = (ctx.persons ?? []).find(
      (p) => p.name.toLowerCase() === ownerName.toLowerCase(),
    );
    if (!m) {
      errors.push({ field: 'owner_person_name', message: `No person named "${ownerName}".` });
    } else {
      ownerPersonId = m.id;
    }
  }

  // excluded_from_net_worth (optional, default false)
  let excludedFromNetWorth = false;
  const excRaw = (raw.excluded_from_net_worth ?? '').trim().toLowerCase();
  if (BOOLEAN_TRUE.has(excRaw)) {
    excludedFromNetWorth = true;
  } else if (!BOOLEAN_FALSE.has(excRaw)) {
    errors.push({
      field: 'excluded_from_net_worth',
      message: 'Use true/false (or yes/no, 1/0).',
    });
  }

  const resolved: VehicleResolved = {
    householdId: 1, // stamped at commit time
    ownerPersonId,
    name,
    year,
    make,
    model,
    purchaseDate,
    purchasePrice,
    currentEstimatedValue,
    linkedLoanId: null,
    excludedFromNetWorth,
  };

  let status: PreviewRow['status'] = 'new';
  let existingId: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingVehicleConflicts) {
    const existing = ctx.existingVehicleConflicts.get(name.toLowerCase());
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function vehicleTemplateCsv(): string {
  return [
    'name,year,make,model,current_estimated_value,purchase_date,purchase_price,owner_person_name,excluded_from_net_worth',
    'Daily Driver,2020,Toyota,Camry,18000,2020-05-01,25000,Alice,false',
    'Weekend Car,2018,Ford,Mustang,22000,2019-01-15,28000,Alice,false',
  ].join('\n');
}
