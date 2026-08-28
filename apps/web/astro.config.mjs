// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

// WiseEvidence public site — static-first at Milestone 1.
// No SSR adapter: pages are prerendered to static HTML, with React used only
// as interactive islands (ADR-004, docs/reports/TECH-STACK-DECISION.md).
export default defineConfig({
  output: "static",
  integrations: [react(), tailwind()],
});
