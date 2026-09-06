import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "node:child_process";
import {
  DEV_STAMP_PATH,
  devCacheDirFor,
  devRoleFromEnv,
  type DevStamp,
} from "./scripts/dev-servers";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const browserShim = process.env.VITE_BROWSER_SHIM === "1";

// W-I D-I2: the server ROLE keys the dep cache (the config function cannot
// see `--port`). CAIRN_DEV_ROLE wins; else seed / browser / tauri is derived
// from the two VITE_ flags. A typo throws in devRoleFromEnv.
const devRole = devRoleFromEnv(process.env);

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
      { find: "@tauri-apps/plugin-updater", replacement: path.join(shimDir, "plugin-updater.ts") },
      { find: "@tauri-apps/api/core", replacement: path.join(shimDir, "api-core.ts") },
    ]
  : [];

function gitHead(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * W-I D-I3: the dev stamp. `apply: "serve"` — the plugin is not even loaded
 * for `vite build`, so the production bundle and the Tauri app are untouched
 * by construction (no client code, no `define`, no optimizer-hash input).
 * GET /__cairn/dev-stamp answers with the tree this server serves (`root`),
 * its role/port/seed flag, the nonce of the process that launched it (null
 * when started by hand) and an informational git head. e2e/global-setup.ts
 * reads it before any test runs: a Playwright run can no longer attach to a
 * sibling worktree's server and test the wrong tree in silence.
 */
function cairnDevStamp(): Plugin {
  return {
    name: "cairn-dev-stamp",
    apply: "serve",
    configureServer(server) {
      const head = gitHead();
      server.middlewares.use(DEV_STAMP_PATH, (_req, res) => {
        const stamp: DevStamp = {
          root: server.config.root,
          role: devRole,
          port: server.config.server.port ?? null,
          seed: process.env.VITE_SEED_DEMO === "1",
          nonce: process.env.CAIRN_DEV_NONCE ?? null,
          pid: process.pid,
          head,
          cacheDir: server.config.cacheDir,
        };
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(stamp));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), cairnDevStamp()],

  // W-I D-I1: `<tree>/.vite.local/<role>` — one dep cache per server role, per
  // worktree. Vite's default (`node_modules/.vite`) is SHARED by every tree
  // whose node_modules is a symlink to the main checkout: two servers cold-
  // optimizing at once rewrote it under each other (two `?v=<hash>` values in
  // one page → "Failed to fetch dynamically imported module", lazy routes stuck
  // at "Loading page…", two React copies → "Invalid hook call"). `.vite.local`
  // is covered by .gitignore's `*.local` — no ignore line needed.
  cacheDir: devCacheDirFor(__dirname, devRole),

  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      ...shimAliases,
    ],
  },

  // Vendor chunk splitting. Without manualChunks Rollup folds every static
  // dependency into a single ~1.7 MB App-*.js. The split below pulls the
  // heaviest libraries into their own files so they:
  //   1. cache independently across releases (changing app code no longer
  //      invalidates 1.7 MB of recharts/radix/etc.)
  //   2. parallel-download alongside the entry chunk
  //   3. keep the entry chunk under the Vite 500 kB warning threshold
  // pdfjs-dist is included so that even if a caller forgets to use the
  // dynamic-import handler (TransactionsSectionImporter does), the worker
  // doesn't end up inlined into the entry.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
          ],
          router: ["react-router-dom"],
          forms: ["react-hook-form", "@hookform/resolvers", "zod"],
          pdf: ["pdfjs-dist"],
        },
      },
    },
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
