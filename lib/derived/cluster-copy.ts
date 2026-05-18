/**
 * Cluster-copy registry. Single source of truth for the German display strings
 * that appear in /settings/clusters rows, DerivedCell eyebrows, EmptyStateCard
 * preflight/abstain copy, and per-cluster auto_process defaults (OQ-5).
 *
 * Consumers (U2 DerivedCell refinement, U3 domain unification, U4 settings/
 * IA) import via `getClusterCopy(cluster)`. Unknown clusters → null, which
 * each consumer handles independently (typically by falling back to a
 * generic empty-state).
 */

export interface ClusterCopy {
  /** German display name for /settings/clusters rows + DerivedCell eyebrows. */
  label: string;
  /** One-sentence description for /settings/clusters rows. */
  description: string;
  /** German CTA label rendered in the empty-state when never_computed. */
  emptyCta: string;
  /** German fallback text when payload.abstain === true. */
  abstainFallback: string;
  /** Auto-process default — OQ-5: per-cluster. */
  autoProcessDefault: boolean;
}

export const CLUSTER_COPY: Record<string, ClusterCopy> = {
  synthesis_v3: {
    label: "Tages-Analyse",
    description: "Cross-domain Synthese am Tagesende.",
    emptyCta: "Tages-Insight anfordern",
    abstainFallback: "Nicht genug Daten für eine Tagesanalyse.",
    autoProcessDefault: true,
  },
  morning_insight: {
    label: "Morgen-Briefing",
    description: "Hebel-basierte Tagesplanung aus Schlaf-Daten.",
    emptyCta: "Briefing anfordern",
    abstainFallback: "Briefing folgt mit der nächsten Schlaf-Synchronisation.",
    autoProcessDefault: true,
  },
  weekly_recap: {
    label: "Wochen-Recap",
    description: "Trajektorien, Streaks, Mikro-Experimente.",
    emptyCta: "Wochen-Recap anfordern",
    abstainFallback: "Recap noch nicht generiert.",
    autoProcessDefault: true,
  },
  anomaly_explain: {
    label: "Anomalie-Erklärung",
    description: "Hypothesen für Ausschläge in Wearable-Werten.",
    emptyCta: "Warum?",
    abstainFallback: "Keine Hypothesen verfügbar.",
    autoProcessDefault: true,
  },
  // Future clusters — defaults off until explicitly opted-in.
  sleep_insight: {
    label: "Schlaf-Insight",
    description: "Schlaf-spezifische Analyse.",
    emptyCta: "Schlaf-Insight anfordern",
    abstainFallback: "Datenfenster zu schmal.",
    autoProcessDefault: false,
  },
  recovery_insight: {
    label: "Erholungs-Insight",
    description: "Erholungs-Analyse.",
    emptyCta: "Erholungs-Insight anfordern",
    abstainFallback: "Datenfenster zu schmal.",
    autoProcessDefault: false,
  },
  activity_insight: {
    label: "Bewegungs-Insight",
    description: "Aktivitäts-Analyse.",
    emptyCta: "Bewegungs-Insight anfordern",
    abstainFallback: "Datenfenster zu schmal.",
    autoProcessDefault: false,
  },
};

export function getClusterCopy(cluster: string): ClusterCopy | null {
  return CLUSTER_COPY[cluster] ?? null;
}
