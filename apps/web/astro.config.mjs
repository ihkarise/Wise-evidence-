// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Static-first: Astro's default `output: 'static'` pre-renders every page.
// React is loaded only for interactive islands (e.g. CopyDoi), never for the
// whole page — see docs/04 §7-9 and docs/15 §4.
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
