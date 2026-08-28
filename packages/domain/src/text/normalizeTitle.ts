/**
 * Title normalization for deduplication support (docs/05 §11, docs/11 §7).
 *
 * Dedup order is DOI → persistent id → normalized title → author+year →
 * similarity. This produces the canonical, comparable title string used for the
 * normalized-title stage: lower-cased, accent-folded, punctuation removed, and
 * whitespace collapsed. It is deliberately lossy for comparison only — it is
 * never shown to users and never overwrites the canonical title.
 *
 * Framework-independent: no imports, no I/O.
 */
export function normalizeTitle(input: string): string {
  if (typeof input !== "string") {
    return "";
  }
  return (
    input
      .normalize("NFKD")
      // Drop combining marks (accent folding).
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // Any run of non-alphanumerics becomes a single space.
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}
