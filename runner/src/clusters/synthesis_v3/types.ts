/**
 * Shape of the payload stored under the `synthesis_v3` cluster.
 *
 * Mirrors the legacy `SynthesisInsightV3` schema at
 * `runner/src/v3/schemas/synthesis_insight.schema.json` so the prose stage
 * can dual-write `daily_v3.json` byte-for-byte while also writing the
 * JobCell row.
 *
 * Cell-key convention: the wake-date itself (`YYYY-MM-DD`). scope =
 * "daily". The worker derives the extract input from the cell key (see
 * `parseSynthesisInputFromKey`).
 *
 * Auto-process default is OFF (Phase 3 spec). The legacy
 * `runV3Cluster(...)` / `runV3(...)` path auto-fires on every `day_end`
 * (and indirectly via the v3-orchestrator's morning sequence), so a
 * silent-synthesis isn't possible during the dual-write window. Flip
 * `settings:auto_process` (global) or `settings:auto_process:synthesis_v3`
 * (per-cluster) to restore the automatic cluster recompute.
 *
 * The dashboard's `lib/v3-loaders.ts` re-exports `SynthesisV3Payload` as
 * the read-side `SynthesisInsightV3` type so there's one source of truth
 * for the shape on both halves.
 */

export type SynthesisVerdictBand = "above_usual" | "steady" | "below_usual";
export type SynthesisDomain = "sleep" | "recovery" | "activity";
export type SynthesisSourceDomain = SynthesisDomain | "cross_domain";
export type SynthesisHorizon = "today" | "tonight";

export interface SynthesisTopAction {
  reasoning: string;
  source_domain: SynthesisSourceDomain;
  anchor: string;
  tiny: string;
  why: string;
  horizon: SynthesisHorizon;
}

export interface SynthesisDomainPointer {
  reasoning: string;
  domain: SynthesisDomain;
  label_de: string;
  kpi_id: string;
  kpi_value: number;
  kpi_band: SynthesisVerdictBand;
  callout: string;
}

export interface SynthesisContradiction {
  reasoning: string;
  domains: SynthesisDomain[];
  conflict: string;
  resolution: string;
}

export interface SynthesisConfidence {
  value: number;
  reasoning: string;
}

export interface SynthesisV3Payload {
  schema_version: "use_case/synthesis/v1";
  language: "de" | "en";
  /**
   * Auto-injected by the legacy writer: true = artifact still in-flight
   * or failed validation; writer flips to false at atomic-rename time.
   * The cluster preserves this flag on the dual-written file so existing
   * dashboard readers (which gate on `incomplete === false`) keep working.
   */
  incomplete: boolean;
  abstain: boolean;
  abstain_reason: string | null;
  verdict_band: SynthesisVerdictBand | null;
  headline: string | null;
  summary_short: string | null;
  summary_long: string | null;
  key_insight: string | null;
  top_action_today: SynthesisTopAction | null;
  /** Always 3 items in order: sleep, recovery, activity. */
  domain_pointers: SynthesisDomainPointer[];
  contradictions: SynthesisContradiction[];
  confidence: SynthesisConfidence;
  /**
   * Cluster-only metadata. Not part of the legacy schema — added to the
   * JobCell payload so the worker can attach the model tag (and the
   * "base+critic" composition once Phase 4 lands) without polluting the
   * legacy `daily_v3.json` shape. Stripped on dual-write.
   */
  model?: string;
  /**
   * Cluster cell-key (wake-date YYYY-MM-DD). Mirrors the period_key.
   * Same approach as morning_insight.period_key — convenient round-trip,
   * stripped on dual-write.
   */
  period_key?: string;
}

export interface SynthesisExtractInput {
  period_key: string;
}
