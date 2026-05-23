import type { AppSettings } from '@/types/schema';

/**
 * Whether the native monthly check-in notification is due right now.
 * `true` only when the user has notifications enabled AND today's
 * day-of-month equals the configured `notificationDay` (bounded 1..28 by
 * the schema, so it exists in every month). `main.tsx` uses this to gate
 * the bootstrap `sendNotification` call. The in-app monthly banner is a
 * separate surface and is NOT gated by this.
 */
export function shouldNotify(settings: AppSettings, now: Date): boolean {
  return settings.notificationsEnabled && now.getDate() === settings.notificationDay;
}
