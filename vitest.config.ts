/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Default is 5_000 ms. The EquityGrantsTab vesting-template tests
    // mount a 37-row schedule (each row is a DatePicker + Input + button)
    // and the FOUR_YR_MONTHLY_ONE_YR_CLIFF tests sit at ~5.2s under the
    // full-suite parallel contention introduced by additional store
    // imports (transactions / snapshots / asset-value-snapshots now ship
    // optimistic mutation paths in their module bodies). 10s is a
    // comfortable margin that doesn't hide actual hangs — most tests
    // continue to complete in under 1 second.
    testTimeout: 10_000,
  },
});
