// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import node from "@astrojs/node";

// WiseEvidence web — hybrid rendering at Milestone 3 (ADR-004, ADR-014).
//
// Default output stays "static": the public marketing pages (/, /methodology)
// remain prerendered. The Node adapter enables on-demand SSR for the pages that
// need it — admin surfaces, API routes, and the public research detail page —
// which opt in with `export const prerender = false`. Authentication,
// authorization, and privileged writes all run server-side (docs/26 §1, §7).
export default defineConfig({
  output: "static",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), tailwind()],
});
