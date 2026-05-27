# Finance App

Personal finance tracking and planning app for households. Standalone Tauri desktop app with local SQLite storage.

## Disclaimer

This is a personal project distributed under the MIT License (see
[LICENSE](LICENSE)). It is **not financial, investment, tax, legal,
or accounting advice**. Calculations, projections, and recommendations
are generated mechanically from the data you enter and from public
reference data; they may be incomplete, outdated, or wrong. **You are
solely responsible for verifying anything before acting on it**, and
should consult a qualified professional for decisions that materially
affect your finances.

The app stores all data locally on your device. The author cannot
recover lost data or restore a corrupted database. Use of this app is
**at your own risk**, with no warranty of any kind to the maximum
extent permitted by law.

This software is not affiliated with, endorsed by, or sponsored by
Yahoo, Yahoo Finance, or any other third party whose data or APIs
it may access. Tax reference data is **U.S.-only** and reflects the
author's best effort at the time of publication; tax law changes
frequently.

## Status

Phase 1 complete: app boots, household + persons + dependents are editable and persistent.

See `docs/superpowers/specs/2026-05-11-finance-app-design.md` for the full spec, and `docs/superpowers/plans/` for phase plans.

## Development

```bash
# install dependencies
npm install

# run in dev mode (opens a native window)
npm run tauri dev

# run unit tests
npm test
```

## Tech stack

- Tauri 2.x (Rust shell, macOS + Windows)
- React 19 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- SQLite (via `@tauri-apps/plugin-sql` in production; `better-sqlite3` in tests)
- Zustand (state) + Zod (validation) + React Hook Form
- Vitest + React Testing Library
- yahoo-finance2 (market data — used in Phase 2+)
