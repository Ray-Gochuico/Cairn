import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * App-wide theme provider. Wires `next-themes` to manage Light / Dark /
 * System modes:
 *   - persists the user's choice to `localStorage` under "theme"
 *   - toggles a `dark` class on `<html>` so the `.dark { … }` block in
 *     globals.css activates the dark token palette and every `dark:`
 *     Tailwind utility comes alive
 *   - honors `prefers-color-scheme` when the mode is "system"
 *
 * We avoid the FOUC by setting `disableTransitionOnChange` — the inline
 * `<script>` next-themes ships with sets the class before React mounts so
 * the page renders in the right palette from the first paint.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

export default ThemeProvider;
