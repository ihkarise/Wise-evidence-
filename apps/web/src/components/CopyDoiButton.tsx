import { useState } from 'react';
import { normalizeDoi } from '@wise-evidence/domain';

/**
 * Copy-DOI button for a research record. Reuses the domain normalizer (Phase 14)
 * to render/copy the canonical DOI — no duplicated normalization logic.
 */
export default function CopyDoiButton({ doi }: { doi: string }) {
  const [copied, setCopied] = useState(false);
  const normalized = normalizeDoi(doi);
  const canonical = normalized.ok ? normalized.doi : doi;

  async function copy() {
    try {
      await navigator.clipboard.writeText(canonical);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
    >
      {copied ? 'Copied' : 'Copy DOI'}
    </button>
  );
}
