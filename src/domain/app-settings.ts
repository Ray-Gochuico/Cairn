import type { Database } from '@/db/db';
import { AppSettingsSchema, type AppSettings, type SidebarLayoutEntry } from '@/types/schema';
import { CompoundingFrequency } from '@/types/enums';

interface AppSettingsRow {
  id: number;
  sidebar_layout: string | null;
  notifications_enabled: number;
  notification_day: number;
  refresh_cadence: string;
  last_refresh_at: string | null;
  statements_folder_path: string | null;
  default_inflation: number | null;
  default_return_rate: number | null;
  default_fi_pills_position: 'above' | 'below';
  default_projection_detail_level: 'single' | 'tax_bucket' | 'per_account';
  default_cash_apy: number | null;
  default_compounding_frequency: CompoundingFrequency;
  property_utilities_category_ids: string | null;
  vehicle_gas_category_ids: string | null;
  auto_invest_salary_surplus: number;
}

/**
 * Parse a JSON-encoded number[] from a TEXT column. Malformed JSON, missing
 * value, or non-array contents fall back to null so the resolver treats the
 * field as "unconfigured" and uses the seeded default. Non-integer or
 * non-positive elements are filtered out; if filtering empties a non-empty
 * input array we treat the column as null (defensive — schema would reject
 * those values anyway).
 *
 * - null → null (column unset)
 * - '[]' → []   (explicit empty)
 * - '[1,2]' → [1, 2]
 * - 'garbage' → null (malformed)
 * - '"oops"' → null (non-array)
 * - '[1, "x"]' → [1] (filter the bad element, keep the good)
 */
function parseIdArray(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter(
      (x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0,
    );
    if (parsed.length > 0 && ids.length === 0) return null;
    return ids;
  } catch {
    return null;
  }
}

function rowToAppSettings(row: AppSettingsRow): AppSettings {
  const sidebarLayout: SidebarLayoutEntry[] | null = row.sidebar_layout
    ? JSON.parse(row.sidebar_layout)
    : null;
  return AppSettingsSchema.parse({
    id: 1,
    sidebarLayout,
    notificationsEnabled: row.notifications_enabled === 1,
    notificationDay: row.notification_day,
    refreshCadence: row.refresh_cadence,
    lastRefreshAt: row.last_refresh_at,
    statementsFolderPath: row.statements_folder_path,
    defaultInflation: row.default_inflation,
    defaultReturnRate: row.default_return_rate,
    defaultFiPillsPosition: row.default_fi_pills_position,
    defaultProjectionDetailLevel: row.default_projection_detail_level,
    defaultCashApy: row.default_cash_apy,
    defaultCompoundingFrequency: row.default_compounding_frequency ?? CompoundingFrequency.MONTHLY,
    propertyUtilitiesCategoryIds: parseIdArray(row.property_utilities_category_ids),
    vehicleGasCategoryIds: parseIdArray(row.vehicle_gas_category_ids),
    autoInvestSalarySurplus: row.auto_invest_salary_surplus === 1,
  });
}

export class SettingsRepo {
  constructor(private db: Database) {}

  async get(): Promise<AppSettings> {
    const rows = await this.db.select<AppSettingsRow>(
      'SELECT * FROM app_settings WHERE id = 1',
    );
    if (rows.length === 0) {
      throw new Error('app_settings singleton row missing — migration 0014 may not have run');
    }
    return rowToAppSettings(rows[0]);
  }

  async update(patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
    const current = await this.get();
    const merged = { ...current, ...patch };
    AppSettingsSchema.parse(merged);

    await this.db.execute(
      `UPDATE app_settings SET
        sidebar_layout = ?,
        notifications_enabled = ?,
        notification_day = ?,
        refresh_cadence = ?,
        last_refresh_at = ?,
        statements_folder_path = ?,
        default_inflation = ?,
        default_return_rate = ?,
        default_fi_pills_position = ?,
        default_projection_detail_level = ?,
        default_cash_apy = ?,
        default_compounding_frequency = ?,
        property_utilities_category_ids = ?,
        vehicle_gas_category_ids = ?,
        auto_invest_salary_surplus = ?
       WHERE id = 1`,
      [
        merged.sidebarLayout === null ? null : JSON.stringify(merged.sidebarLayout),
        merged.notificationsEnabled ? 1 : 0,
        merged.notificationDay,
        merged.refreshCadence,
        merged.lastRefreshAt,
        merged.statementsFolderPath,
        merged.defaultInflation,
        merged.defaultReturnRate,
        merged.defaultFiPillsPosition,
        merged.defaultProjectionDetailLevel,
        merged.defaultCashApy ?? null,
        merged.defaultCompoundingFrequency,
        merged.propertyUtilitiesCategoryIds === null
          ? null
          : JSON.stringify(merged.propertyUtilitiesCategoryIds),
        merged.vehicleGasCategoryIds === null
          ? null
          : JSON.stringify(merged.vehicleGasCategoryIds),
        merged.autoInvestSalarySurplus ? 1 : 0,
      ],
    );
  }
}
