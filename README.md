# Finance App

Personal finance tracking and planning app for households. Standalone Tauri desktop app with local SQLite storage.

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
