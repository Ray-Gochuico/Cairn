import React from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';
import { initDatabase } from './db/init';
import { getDatabase } from './db/db';
import { PersonsRepo } from './domain/persons';
import { SettingsRepo } from './domain/app-settings';
import { shouldNotify } from './lib/notification-due';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

async function bootstrap() {
  try {
    await initDatabase();

    // First-launch detection: if no persons exist yet AND the user is
    // landing on the root route, redirect to the setup wizard before
    // React mounts so we don't flash the dashboard.
    try {
      const persons = await new PersonsRepo(getDatabase()).list();
      const path = window.location.pathname;
      if (persons.length === 0 && (path === '/' || path === '')) {
        window.history.replaceState({}, '', '/setup');
      }
    } catch (e) {
      // Don't block boot if the persons query fails — fall through to
      // normal app render and surface errors via the in-app error pane.
      // eslint-disable-next-line no-console
      console.warn('[bootstrap] first-launch detection failed:', e);
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

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <AppDisclaimerGate>
          <App />
        </AppDisclaimerGate>
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
