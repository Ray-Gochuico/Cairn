import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

/**
 * Settings page "Appearance" section. Three-way radio (Light / Dark /
 * System) hooked into next-themes. The provider toggles a `dark` class
 * on `<html>` so the `.dark { … }` block in globals.css activates the
 * dark palette and every `dark:` Tailwind utility comes alive.
 *
 * We render an empty shell until `mounted` is true to dodge the
 * next-themes hydration mismatch (server / first paint doesn't know
 * which theme the user previously picked).
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Pick a theme. <strong>System</strong> follows your OS preference and
          updates automatically when you switch macOS / Windows between Light
          and Dark Mode.
        </p>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2 max-w-md"
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mounted && theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!mounted}
                onClick={() => setTheme(option.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-md border bg-background px-3 py-3 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'hover:bg-accent',
                  selected && 'border-primary ring-2 ring-ring',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <Label className="cursor-pointer">{option.label}</Label>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
