import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useSettingsStore } from '@/stores/settings-store';

const selectClass =
  'flex h-9 w-24 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// 1..28 — bounded so the chosen day exists in every month (no February
// edge case), matching the schema's notificationDay constraint.
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export function NotificationsSection() {
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);

  useEffect(() => {
    void load();
  }, [load]);

  const enabled = settings?.notificationsEnabled ?? true;
  const day = settings?.notificationDay ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold leading-none tracking-tight">Notifications</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          A native reminder to confirm this month's balances. The in-app
          banner always shows when input is pending — this only controls
          the OS notification.
        </p>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              id="notifications-enabled"
              type="checkbox"
              aria-label="Monthly check-in reminder"
              checked={enabled}
              disabled={settings === null}
              onChange={(e) => void update({ notificationsEnabled: e.target.checked })}
            />
            <Label htmlFor="notifications-enabled">Monthly check-in reminder</Label>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="notification-day">Day of month</Label>
            <select
              id="notification-day"
              aria-label="Day of month"
              className={selectClass}
              value={day}
              disabled={settings === null || !enabled}
              onChange={(e) => void update({ notificationDay: Number(e.target.value) })}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
