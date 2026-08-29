import { defineConfig } from "vitest/config";

// Root Vitest config for the workspace. Unit tests live next to the domain
// logic they cover. No jsdom / no network — domain logic is pure and portable.
export default defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
    // PGlite boots an in-process WASM PostgreSQL; its first cold start (WASM
    // compile + migrations + seed) can exceed the 10s default on slower/CI
    // machines. Give setup/teardown hooks and tests generous headroom so the
    // deterministic database suite is not flaky. This changes only timing.
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
