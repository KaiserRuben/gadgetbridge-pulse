/**
 * Shared confidence tier mapping. Lifted out of the legacy `<ConfidenceBar>`
 * so the new `<Confidence>` primitive (mode: bar | pill | dot) and any other
 * consumer can stay in sync without re-declaring the threshold ladder.
 *
 * Ladder:
 *   value >= 0.7  → up      (high — verdict-grade signal)
 *   value >= 0.5  → steady  (mid — usable but caveated)
 *   value <  0.5  → down    (low — surface with a caveat or hide)
 */

export type ConfidenceTier = "up" | "steady" | "down";

export function confidenceTier(value: number): ConfidenceTier {
  if (value >= 0.7) return "up";
  if (value >= 0.5) return "steady";
  return "down";
}
