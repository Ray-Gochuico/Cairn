/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to '1' by `dev:browser*` scripts to activate the @tauri-apps/* browser shims. */
  readonly VITE_BROWSER_SHIM?: string;
  /** Set to '1' by `dev:browser:seed` to populate dev-only demo data for the donut smoke. */
  readonly VITE_SEED_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
