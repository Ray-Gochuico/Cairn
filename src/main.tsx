import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './globals.css';
import { initDatabase } from './db/init';
import { getDatabase } from './db/db';
import { PersonsRepo } from './domain/persons';

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

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (e) {
    const root = document.getElementById('root') as HTMLElement;
    root.innerHTML = `<div style="padding:24px;font-family:system-ui;color:#dc2626">
      <h1>Database initialization failed</h1>
      <pre style="background:#f3f4f6;padding:12px;border-radius:6px;white-space:pre-wrap;">${
        e instanceof Error ? e.message + '\n\n' + e.stack : String(e)
      }</pre>
    </div>`;
  }
}

bootstrap();
