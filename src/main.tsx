import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './globals.css';
import { initDatabase } from './db/init';

async function bootstrap() {
  try {
    await initDatabase();
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
