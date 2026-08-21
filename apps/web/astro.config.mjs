// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Hybrid rendering (ADR-013). Output stays static-by-default: informational pages
// (/, /methodology) are prerendered. Dynamic routes opt into SSR with
// `export const prerender = false` — /research/[id], /admin/*, /api/* — served by
// the @astrojs/node adapter. React is used only for interactive islands.
export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
