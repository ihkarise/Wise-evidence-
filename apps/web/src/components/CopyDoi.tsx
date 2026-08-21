import { useState } from 'react';
import { normalizeDoi } from '@wise-evidence/domain';

/**
 * CopyDoi — a small interactive island proving the workspace wiring end to end:
 * it imports `normalizeDoi` from `@wise-evidence/domain` and uses it to
 * canonicalize a pasted DOI before copying. This is the only interactive
 * component in Milestone 1; the rest of the site is static (docs/15 §4).
 */
export default function CopyDoi() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const result = normalizeDoi(input);
  const canonical = result.ok ? result.doi : null;

  async function handleCopy() {
    if (!canonical) {
      setStatus('Enter a valid DOI (e.g. 10.1234/abcd) to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(canonical);
      setStatus(`Copied canonical DOI: ${canonical}`);
    } catch {
      // Clipboard may be unavailable (permissions, insecure context); still
      // surface the canonical value so the action is never a dead end.
      setStatus(`Canonical DOI: ${canonical}`);
    }
  }

  return (
    <div className="max-w-md rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <label htmlFor="doi-input" className="block text-sm font-medium">
        Try DOI normalization
      </label>
      <p className="mt-1 text-xs text-slate-500">
        Paste a DOI in any form — <code>doi:</code>, a <code>doi.org</code> URL, or bare — and it
        is reduced to one canonical value.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          id="doi-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://doi.org/10.1234/abcd"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={handleCopy}
          disabled={!canonical}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          Copy
        </button>
      </div>
      <p className="mt-2 min-h-5 text-xs" aria-live="polite">
        {input.trim() === ''
          ? ''
          : canonical
            ? `Canonical: ${canonical}`
            : 'Not a recognizable DOI yet.'}
      </p>
      {status && (
        <p className="mt-1 text-xs text-slate-500" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}
