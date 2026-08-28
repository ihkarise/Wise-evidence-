import { useId, useState } from "react";
import { normalizeDoi } from "@wise-evidence/domain";

/**
 * CopyDoi — the one real React island in Milestone 1.
 *
 * Its purpose is twofold:
 *   1. Prove the workspace wiring end-to-end: this browser component imports the
 *      framework-independent `normalizeDoi()` from `@wise-evidence/domain`.
 *   2. Offer a genuinely useful, self-contained tool — paste any DOI form,
 *      normalize it to canonical `10.xxxx/xxxx`, and copy the result.
 *
 * It touches no database and makes no network request.
 */

type Status =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "normalized"; doi: string }
  | { kind: "copied"; doi: string };

const REASON_MESSAGE: Record<string, string> = {
  empty: "Enter a DOI to normalize.",
  "invalid-format": "That does not look like a valid DOI.",
};

export default function CopyDoi(): React.ReactElement {
  const inputId = useId();
  const feedbackId = useId();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function handleNormalize(): void {
    const result = normalizeDoi(value);
    if (result.ok) {
      setStatus({ kind: "normalized", doi: result.doi });
    } else {
      setStatus({ kind: "invalid" });
    }
  }

  async function handleCopy(doi: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(doi);
      setStatus({ kind: "copied", doi });
    } catch {
      // Clipboard may be unavailable (permissions, insecure context). Keep the
      // normalized value visible so the user can copy it manually.
      setStatus({ kind: "normalized", doi });
    }
  }

  const normalized = status.kind === "normalized" || status.kind === "copied" ? status.doi : null;

  let feedback: string | null = null;
  if (status.kind === "invalid") {
    const reason = normalizeDoi(value);
    feedback = reason.ok ? null : (REASON_MESSAGE[reason.reason] ?? "Invalid DOI.");
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleNormalize();
        }}
      >
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          DOI normalizer
        </label>
        <p className="mt-1 text-sm text-ink-muted">
          Paste a DOI in any form (<code>doi:</code>, a <code>doi.org</code> URL, or a bare DOI).
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id={inputId}
            name="doi"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (status.kind !== "idle") setStatus({ kind: "idle" });
            }}
            placeholder="https://doi.org/10.1234/abcd"
            aria-describedby={feedback ? feedbackId : undefined}
            aria-invalid={status.kind === "invalid"}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            Normalize
          </button>
        </div>
      </form>

      <div id={feedbackId} aria-live="polite" className="mt-4 min-h-[2.5rem] text-sm">
        {feedback && <p className="text-red-700">{feedback}</p>}
        {normalized && (
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded bg-white px-2 py-1 font-mono text-ink ring-1 ring-slate-200">
              {normalized}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy(normalized)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              {status.kind === "copied" ? "Copied ✓" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
