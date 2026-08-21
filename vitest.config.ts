import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    environment: 'node',
    // PGlite (embedded Postgres, WASM) boots and applies migrations per suite,
    // which can take several seconds; give database tests room (ADR-012).
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
