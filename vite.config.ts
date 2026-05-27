import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const browserShim = process.env.VITE_BROWSER_SHIM === "1";

const shimDir = path.resolve(__dirname, "./src/lib/browser-shims");

// When VITE_BROWSER_SHIM=1, swap every @tauri-apps/* import for the matching
// shim under src/lib/browser-shims/. The Tauri prod build sets no env var and
// resolves the real plugin packages from node_modules. See
// src/lib/browser-shims/README.md for the per-plugin support matrix.
const shimAliases = browserShim
  ? [
      { find: "@tauri-apps/plugin-sql", replacement: path.join(shimDir, "plugin-sql.ts") },
      { find: "@tauri-apps/plugin-fs", replacement: path.join(shimDir, "plugin-fs.ts") },
      { find: "@tauri-apps/plugin-dialog", replacement: path.join(shimDir, "plugin-dialog.ts") },
      { find: "@tauri-apps/plugin-notification", replacement: path.join(shimDir, "plugin-notification.ts") },
      { find: "@tauri-apps/plugin-http", replacement: path.join(shimDir, "plugin-http.ts") },
      { find: "@tauri-apps/plugin-opener", replacement: path.join(shimDir, "plugin-opener.ts") },
      { find: "@tauri-apps/api/core", replacement: path.join(shimDir, "api-core.ts") },
    ]
  : [];

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      ...shimAliases,
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: browserShim ? 1421 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
