import React from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';
import { initDatabase } from './db/init';
import { getDatabase } from './db/db';
import { PersonsRepo } from './domain/persons';
import { SettingsRepo } from './domain/app-settings';
import { shouldNotify } from './lib/notification-due';
import { maybeRedirectToMonthly } from './lib/monthly-prompt';
import { isSetupDismissed, shouldRedirectToSetup } from './lib/setup-dismissal';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

async function bootstrap() {
  try {
    await initDatabase();

    // First-launch detection: if no persons exist yet AND the user has not
    // already finished/dismissed the wizard AND is landing on the root route,
    // redirect to the setup wizard before React mounts so we don't flash the
    // dashboard. The dismissed marker (set by handleFinish) prevents the H1
    // re-entry trap where a skip-heavy setup with zero persons would loop the
    // user back to /setup on every launch.
    try {
      const persons = await new PersonsRepo(getDatabase()).list();
      const path = window.location.pathname;
      if (
        shouldRedirectToSetup({
          personCount: persons.length,
          dismissed: isSetupDismissed(),
          path,
        })
      ) {
        window.history.replaceState({}, '', '/setup');
      }
    } catch (e) {
      // Don't block boot if the persons query fails — fall through to
      // normal app render and surface errors via the in-app error pane.
      // eslint-disable-next-line no-console
      console.warn('[bootstrap] first-launch detection failed:', e);
    }

    // On the first app open of a new calendar month (and early in the month),
    // auto-route to /monthly?from=new-month so the user sees the monthly
    // ritual without having to find the Dashboard banner. Runs AFTER the
    // first-launch /setup check above: if the path is still '/', the user is
    // not a first-launch user and the monthly route is appropriate. Stamp
    // fires at decide-time (even when grace suppresses the route) so the
    // prompt is consumed exactly once per calendar month. Fail-quiet.
    try {
      await maybeRedirectToMonthly(getDatabase(), new Date()); // win defaults to window
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[bootstrap] monthly-prompt trigger failed:', e);
    }

    // Fire an optional native notification on the user's chosen day of the
    // month so users who haven't opened the app yet see the nudge. The
    // settings store is not mounted this early in bootstrap, so read the
    // singleton through the repo directly — the same pattern as the
    // first-launch PersonsRepo.list() call above. In-app banner remains the
    // primary surface; this is bonus, and the user can disable it.
    void (async () => {
      try {
        const settings = await new SettingsRepo(getDatabase()).get();
        if (!shouldNotify(settings, new Date())) return;
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === 'granted';
        if (granted) {
          sendNotification({
            title: 'Monthly input pending',
            body: 'Confirm this month’s account balances when you have a moment.',
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[bootstrap] notification dispatch failed:', e);
      }
    })();

    // Dynamic-import App so createBrowserRouter inside App.tsx only runs
    // after the first-launch replaceState above. A static import would
    // execute App.tsx at module load — before bootstrap() ran — and the
    // router would capture window.location.pathname === '/', then ignore
    // the subsequent URL change.
    const { default: App } = await import('./App');
    const { AppDisclaimerGate } = await import('./legal/AppDisclaimerGate');
    const { ThemeProvider } = await import('./components/theme/ThemeProvider');

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <ThemeProvider>
          <AppDisclaimerGate>
            <App />
          </AppDisclaimerGate>
        </ThemeProvider>
      </React.StrictMode>,
    );
  } catch (e) {
    const root = document.getElementById('root') as HTMLElement;
    // Use createElement + textContent instead of innerHTML: error messages
    // can carry user-controlled file paths (XSS-adjacent), and the new CSP
    // lacks 'unsafe-inline' for scripts. textContent is the safe sink for
    // raw strings (innerText would trigger layout reflow).
    const container = document.createElement('div');
    container.style.padding = '24px';
    container.style.fontFamily = 'system-ui';
    container.style.color = '#dc2626';

    const heading = document.createElement('h1');
    heading.textContent = 'Database initialization failed';

    const pre = document.createElement('pre');
    pre.style.background = '#f3f4f6';
    pre.style.padding = '12px';
    pre.style.borderRadius = '6px';
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = e instanceof Error ? e.message + '\n\n' + e.stack : String(e);

    container.appendChild(heading);
    container.appendChild(pre);

    root.replaceChildren(container);
  }
}

bootstrap();
