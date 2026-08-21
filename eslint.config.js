// Flat ESLint config for the WiseEvidence workspace.
// Lints TypeScript/TSX across packages and Astro components in apps/web.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.astro/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  }
);
