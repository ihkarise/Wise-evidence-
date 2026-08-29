// @ts-check
import process from "node:process";
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
//
// Base path / site are ENV-DRIVEN so the same source serves two deployments
// without divergence (docs/19-DEPLOYMENT.md §11–§12):
//   • Production SSR host — served at the domain root: no env set, so
//     `base` = "/" and `site` is undefined. SSR is completely unaffected.
//   • GitHub Pages STATIC PREVIEW — served from the project subpath. The
//     preview workflow sets `SITE_BASE=/Wise-evidence-/` (and optionally
//     `SITE_URL=https://ihkarise.github.io`), so Astro emits every asset URL
//     and prerendered link under that base. See `.github/workflows/preview.yml`.
// `base` must keep a single leading/trailing slash; we normalise defensively.
const rawBase = process.env.SITE_BASE?.trim();
const base = rawBase && rawBase !== "/" ? `/${rawBase.replace(/^\/+|\/+$/g, "")}/` : "/";
const site = process.env.SITE_URL?.trim() || undefined;

export default defineConfig({
  output: "static",
  adapter: node({ mode: "standalone" }),
  base,
  ...(site ? { site } : {}),
  integrations: [react(), tailwind()],
});
