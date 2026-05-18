/**
 * Per-cluster tone lookup for `<DerivedCell>` chrome — the reprocessing badge,
 * the freshness pill, anywhere else that wants a domain-coloured surface
 * tied to a specific JobCell cluster.
 *
 * Synthesis / morning briefing / weekly recap are intentionally treated as
 * "sleep" tone — those surfaces hang off the wake-of-day window and use the
 * sleep palette in HeroV3. Anomaly explanation is "heart" since anomalies
 * are usually HR/HRV-related. Per-domain insight clusters get their domain
 * tone directly. Unknown clusters fall back to neutral.
 *
 * Used by:
 *  - `<DerivedCell>` to colour the reprocessing badge.
 *  - Future: `<DerivedCellStatusPill>` for the cached/fresh chip surface.
 */

export type ClusterTone =
  | "sleep"
  | "heart"
  | "activity"
  | "stress"
  | "nutrition"
  | "neutral";

export function clusterTone(cluster: string): ClusterTone {
  switch (cluster) {
    case "synthesis_v3":
    case "morning_insight":
    case "weekly_recap":
      return "sleep";
    case "anomaly_explain":
      return "heart";
    case "sleep_insight":
    case "recovery_insight":
      return "sleep";
    case "activity_insight":
      return "activity";
    case "stress_insight":
      return "stress";
    case "nutrition_meal":
      return "nutrition";
    default:
      return "neutral";
  }
}
