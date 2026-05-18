/**
 * Feature-flag helper for the JobCell migration. The dashboard sits in
 * front of the runner's cluster registry but doesn't want to crash if
 * the registry happens to be empty (Phase 2b) or if a single cluster
 * hasn't been wired up yet (Phase 3, gradual).
 *
 * This wrapper reads `CLUSTER_REGISTRY` from `@/runner/clusters` defensively
 * and exposes a single boolean predicate consumed by `<InsightSection>`
 * (and any other component that needs to gate JobCell rendering behind
 * the migration). Phase 3 callers don't have to special-case anything —
 * they just pass `cluster + cellKey` to the component, which silently
 * falls back to the legacy path until the cluster lands in the registry.
 *
 * Phase U4 adds helpers that the settings UX needs:
 *   - `listRegisteredClustersWithCopy` — the registered clusters paired
 *     with their German display copy (label, description, autoProcess
 *     default). Unknown-to-copy clusters fall back to a generated label.
 *   - `readClusterMeta` — most-recent insight row + total history depth
 *     for one cluster, rendered into the per-cluster row on
 *     `/settings/clusters`. Server-only — pulls from pulse.db directly so
 *     the page can compute "vor 4 Std. · 18 Tage Verlauf" without a wide
 *     period scan.
 */

import "server-only";

import { CLUSTER_REGISTRY } from "@/runner/clusters";
import { getClusterCopy, type ClusterCopy } from "./cluster-copy";
import { pulseDb } from "../pulse-db";

export function hasClusterRegistered(cluster: string): boolean {
  try {
    return CLUSTER_REGISTRY.has(cluster);
  } catch {
    return false;
  }
}

export function listRegisteredClusters(): string[] {
  try {
    return Array.from(CLUSTER_REGISTRY.keys()).sort();
  } catch {
    return [];
  }
}

export interface ClusterListing {
  name: string;
  copy: ClusterCopy;
}

/**
 * Resolve a synthetic fallback copy for clusters that exist in the runner
 * registry but don't yet have a `CLUSTER_COPY` entry. Keeps the settings
 * page rendering instead of hard-crashing on an unknown cluster.
 */
function fallbackCopy(name: string): ClusterCopy {
  const human = name
    .split("_")
    .map((s) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)))
    .join(" ");
  return {
    label: human,
    description: `Cluster ${name} (kein Beschreibungstext hinterlegt).`,
    emptyCta: "Anfordern",
    abstainFallback: "Keine Ausgabe verfügbar.",
    autoProcessDefault: false,
  };
}

export function listRegisteredClustersWithCopy(): ClusterListing[] {
  return listRegisteredClusters().map((name) => ({
    name,
    copy: getClusterCopy(name) ?? fallbackCopy(name),
  }));
}

export interface ClusterMeta {
  /** Most recent insight `updated_at`, ISO string. `null` when no row exists. */
  lastUpdatedAt: string | null;
  /** Most recent insight status. `null` when no row exists. */
  lastStatus: "pending" | "live" | "partial" | "complete" | null;
  /** Most recent insight error_text — only set when status='partial'. */
  lastError: string | null;
  /** Total number of insight rows for this cluster (history depth). */
  historyCount: number;
}

const EMPTY_META: ClusterMeta = {
  lastUpdatedAt: null,
  lastStatus: null,
  lastError: null,
  historyCount: 0,
};

const KNOWN_STATUSES: ReadonlySet<NonNullable<ClusterMeta["lastStatus"]>> = new Set([
  "pending",
  "live",
  "partial",
  "complete",
]);

function narrowStatus(raw: string | null): ClusterMeta["lastStatus"] {
  if (raw == null) return null;
  return KNOWN_STATUSES.has(raw as NonNullable<ClusterMeta["lastStatus"]>)
    ? (raw as ClusterMeta["lastStatus"])
    : null;
}

/**
 * Fetch the per-cluster metadata used by `/settings/clusters` rows. Reads
 * the entire cluster's history in one round-trip — there are typically tens
 * of rows per cluster, so this is cheap; aggregating in SQL keeps the data
 * surface small for the SSR render.
 */
export function readClusterMeta(cluster: string): ClusterMeta {
  const db = pulseDb();
  if (!db) return EMPTY_META;
  try {
    const row = db
      .prepare<
        [string],
        {
          updated_at: string | null;
          status: string | null;
          error_text: string | null;
          history_count: number;
        }
      >(
        `SELECT
           MAX(updated_at) AS updated_at,
           COUNT(*) AS history_count,
           (SELECT status FROM PULSE_INSIGHT
              WHERE cluster = ?1
              ORDER BY updated_at DESC LIMIT 1) AS status,
           (SELECT error_text FROM PULSE_INSIGHT
              WHERE cluster = ?1
              ORDER BY updated_at DESC LIMIT 1) AS error_text
         FROM PULSE_INSIGHT
         WHERE cluster = ?1`,
      )
      .get(cluster);
    if (!row || row.history_count === 0) return EMPTY_META;
    return {
      lastUpdatedAt: row.updated_at,
      lastStatus: narrowStatus(row.status),
      lastError: row.error_text,
      historyCount: row.history_count,
    };
  } catch {
    return EMPTY_META;
  }
}

/**
 * Count of clusters whose per-cluster `settings:auto_process:<name>` row
 * exists in PULSE_STATE_KV (regardless of value). The settings preview
 * card uses this as a soft "M Cluster konfiguriert" — we deliberately
 * don't try to compare against `autoProcessDefault`, because the user
 * thinks of any persisted override as "configured", not just disagreements
 * with the default.
 */
export function countConfiguredClusterOverrides(): number {
  const db = pulseDb();
  if (!db) return 0;
  try {
    const row = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM PULSE_STATE_KV
         WHERE key LIKE 'settings:auto_process:%'`,
      )
      .get();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}
