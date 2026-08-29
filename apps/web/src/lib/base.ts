/**
 * withBase — prefix a root-absolute in-app path with Astro's configured base.
 *
 * WiseEvidence's production SSR host serves the app at the domain root, so
 * `import.meta.env.BASE_URL` is `"/"` and this function is an identity for
 * in-app links (`withBase("/research") === "/research"`). The GitHub Pages
 * STATIC PREVIEW, however, is served from a project subpath
 * (`/Wise-evidence-/`, set via the `SITE_BASE` build env in
 * `.github/workflows/preview.yml`), so `BASE_URL` becomes `"/Wise-evidence-/"`
 * and author-written links must carry that prefix or they 404 against the
 * domain root.
 *
 * Astro already rewrites the asset URLs it generates itself (the hashed
 * `_astro/*.css` / `*.js` bundles, and `<link>`/`<script>` it injects) with the
 * base, but it does NOT rewrite root-absolute `href`/`src`/`action` values you
 * write by hand — those are the responsibility of this helper.
 *
 * Only root-absolute paths (`/...`) are prefixed. External URLs, protocol-
 * relative URLs, anchors, and already-relative paths are returned unchanged.
 */
export function withBase(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return path;
  }
  const base = import.meta.env.BASE_URL; // "/" in production, "/Wise-evidence-/" on Pages
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base; // "" or "/Wise-evidence-"
  return `${trimmed}${path}`;
}
