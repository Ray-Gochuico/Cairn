// src/lib/import/validators/property.ts
import { PropertyType } from '@/types/enums';
import type { Property } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type PropertyResolved = Omit<Property, 'id'>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOOLEAN_TRUE = new Set(['true', '1', 'yes', 'y']);
const BOOLEAN_FALSE = new Set(['false', '0', 'no', 'n', '']);

function isPropertyType(v: string): v is PropertyType {
  return (Object.values(PropertyType) as string[]).includes(v);
}

/**
 * Validate one property import row. PropertyType is required because the
 * underlying schema demands it (PRIMARY_RESIDENCE / RENTAL / VACATION_HOME
 * / LAND). The spec calls it out as optional in the row table but the
 * schema is the source of truth; we require it for the import too.
 */
export function validatePropertyRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<PropertyResolved> {
  const errors: CellError[] = [];

  const name = (raw.name ?? '').trim();
  if (name.length === 0) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'Name must be ≤ 100 chars.' });
  }

  // type (required, PropertyType enum)
  let parsedType: PropertyType = PropertyType.PRIMARY_RESIDENCE;
  const rawType = (raw.type ?? '').trim();
  if (rawType.length === 0) {
    errors.push({ field: 'type', message: 'Type is required.' });
  } else if (!isPropertyType(rawType)) {
    errors.push({
      field: 'type',
      message: `Unknown type "${rawType}". Expected one of: ${Object.values(PropertyType).join(', ')}`,
    });
  } else {
    parsedType = rawType;
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

  // address (optional)
  const address = (raw.address ?? '').trim() || null;

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

  // excluded_from_net_worth (optional boolean, default false)
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

  const resolved: PropertyResolved = {
    householdId: 1, // stamped at commit time
    ownerPersonId,
    name,
    type: parsedType,
    address,
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
  } else if (ctx.existingPropertyConflicts) {
    const existing = ctx.existingPropertyConflicts.get(name.toLowerCase());
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function propertyTemplateCsv(): string {
  return [
    'name,type,current_estimated_value,address,purchase_date,purchase_price,owner_person_name,excluded_from_net_worth',
    `Main Residence,${PropertyType.PRIMARY_RESIDENCE},750000,"123 Main St, Anytown",2020-06-01,650000,Alice,false`,
    `Cabin,${PropertyType.VACATION_HOME},250000,,2022-04-15,225000,Alice,false`,
  ].join('\n');
}
