/**
 * Presentation labels for stored enum values (docs/07 §2, docs/08 §4). Labels
 * are a UI concern kept out of the domain/database packages. These map stored
 * machine values to human display strings; they carry no scores.
 */
export const OUTCOME_LABELS: Record<string, string> = {
  STRONG_POSITIVE: "Strong Positive",
  POSITIVE: "Positive",
  LEANING_POSITIVE: "Mixed / Leaning Positive",
  NEUTRAL_INCONCLUSIVE: "Neutral / Inconclusive",
  LEANING_NEGATIVE: "Mixed / Leaning Negative",
  NEGATIVE: "Negative",
  STRONG_NEGATIVE: "Strong Negative",
  UNCLASSIFIED: "Unclassified",
};

export const QUALITY_LABELS: Record<string, string> = {
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low",
  UNCLEAR: "Unclear",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
};

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function outcomeLabel(value: string | null | undefined): string {
  if (!value) return "Unclassified";
  return OUTCOME_LABELS[value] ?? humanize(value);
}
