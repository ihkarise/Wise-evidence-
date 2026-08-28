import { defineConfig } from "vitest/config";

// Root Vitest config for the workspace. Unit tests live next to the domain
// logic they cover. No jsdom / no network — domain logic is pure and portable.
export default defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
  },
});
