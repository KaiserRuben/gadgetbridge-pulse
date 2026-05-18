/**
 * Cluster registry skeleton. Phase 2b owners (sleep/recovery/activity/…)
 * register entries here; this module only defines the contract + the
 * `resolveStaleCells` fan-out used by the event → cell dispatcher.
 */

import type { PulseEvent } from "../events/bus.ts";
import type {
  CellKey,
} from "../jobs/cell.ts";
import type { PulseDataPackage } from "../jobs/types.ts";

import { extract as extractAnomaly } from "./anomaly_explain/extract.ts";
import { prose as proseAnomaly } from "./anomaly_explain/prose.ts";
import { deps as depsAnomaly } from "./anomaly_explain/deps.ts";
import anomalyExplainSchema from "./anomaly_explain/package.schema.json" with { type: "json" };

import { extract as extractWeekly } from "./weekly_recap/extract.ts";
import { prose as proseWeekly } from "./weekly_recap/prose.ts";
import { deps as depsWeekly } from "./weekly_recap/deps.ts";
import weeklyRecapSchema from "./weekly_recap/package.schema.json" with { type: "json" };

import { extract as extractMorning } from "./morning_insight/extract.ts";
import { prose as proseMorning } from "./morning_insight/prose.ts";
import { deps as depsMorning } from "./morning_insight/deps.ts";
import morningInsightSchema from "./morning_insight/package.schema.json" with { type: "json" };

import { extract as extractSynthesisV3 } from "./synthesis_v3/extract.ts";
import { prose as proseSynthesisV3 } from "./synthesis_v3/prose.ts";
import { deps as depsSynthesisV3 } from "./synthesis_v3/deps.ts";
import synthesisV3Schema from "./synthesis_v3/package.schema.json" with { type: "json" };

export interface ClusterContext {
  periodKey: string;
  tz: string;
  settings: {
    readAutoProcess: (cluster: string) => Promise<boolean>;
    readCritic: () => Promise<boolean>;
  };
}

export interface ProseContext extends ClusterContext {
  criticModel: string | null;
}

export interface ClusterRegistryEntry {
  name: string;
  extract: (ctx: ClusterContext) => Promise<PulseDataPackage>;
  prose: (pkg: PulseDataPackage, ctx: ProseContext) => Promise<PulseDataPackage>;
  /** Cells invalidated by the given event. Empty array = "this event does
   *  not affect this cluster". */
  deps: (event: PulseEvent) => CellKey[];
  payloadSchema: object;
}

export const CLUSTER_REGISTRY = new Map<string, ClusterRegistryEntry>();

// ── Cluster registrations ─────────────────────────────────────────────────
//
// Phase 3a: anomaly_explain. User-triggered LLM cluster — `deps` returns []
// so events never auto-stale it, but the worker still picks the cell up from
// the enqueue queue once a `Warum?` click writes the pending row.
//
// extract/prose cast `as unknown as` because the runtime extract signature
// takes a second `input` arg (parsed from the cell key by the worker) which
// the base `ClusterRegistryEntry` shape — written for auto-process clusters
// that derive everything from `ctx.periodKey` — does not yet model.
CLUSTER_REGISTRY.set("anomaly_explain", {
  name: "anomaly_explain",
  extract: extractAnomaly as unknown as ClusterRegistryEntry["extract"],
  prose: proseAnomaly as unknown as ClusterRegistryEntry["prose"],
  deps: depsAnomaly,
  payloadSchema: anomalyExplainSchema,
});

// Phase 3b: weekly_recap. Migrates the legacy stageW-weekly path; the
// extract+prose signatures take a second `{ week_key }` input arg that
// the worker derives from the cell key (see parseWeeklyInputFromKey).
// Auto-process is OFF by default — the legacy stageW-weekly caller in
// v2-orchestrator stays alive during the dual-write window so a
// silent-Sunday is not possible.
CLUSTER_REGISTRY.set("weekly_recap", {
  name: "weekly_recap",
  extract: extractWeekly as unknown as ClusterRegistryEntry["extract"],
  prose: proseWeekly as unknown as ClusterRegistryEntry["prose"],
  deps: depsWeekly,
  payloadSchema: weeklyRecapSchema,
});

// Phase 3c: morning_insight. Migrates the legacy v3 morning briefing
// (`runV3Cluster("morning", …)`); the extract+prose signatures take a
// `{ period_key }` input arg that the worker derives from the cell key
// (see parseMorningInputFromKey). The cell key equals the wake-date
// (YYYY-MM-DD), same shape as anomaly_explain in driver mode.
//
// Auto-process is OFF by default — the legacy `runV3Cluster("morning")`
// caller in v3-orchestrator + events/subscribers fires on every
// `sleep_complete` and `day_end`, so a silent-morning is not possible
// during the dual-write window. Flip `settings:auto_process` (global)
// or `settings:auto_process:morning_insight` (per-cluster) to recompute
// the cluster row automatically when sleep lands.
CLUSTER_REGISTRY.set("morning_insight", {
  name: "morning_insight",
  extract: extractMorning as unknown as ClusterRegistryEntry["extract"],
  prose: proseMorning as unknown as ClusterRegistryEntry["prose"],
  deps: depsMorning,
  payloadSchema: morningInsightSchema,
});

// Phase 3d: synthesis_v3. Migrates the legacy v3 day-level synthesis
// (`runV3` / `runSynthesis` in v3-orchestrator); the extract+prose
// signatures take a `{ period_key }` input arg that the worker derives
// from the cell key (see parseSynthesisInputFromKey). The cell key
// equals the wake-date (YYYY-MM-DD), same shape as morning_insight in
// driver mode.
//
// Auto-process is OFF by default — the legacy `runV3` caller in
// `events/subscribers.ts` fires on every `day_end`, so the
// `daily_v3.json` file stays fresh during the dual-write window. Flip
// `settings:auto_process` (global) or `settings:auto_process:synthesis_v3`
// (per-cluster) to recompute the cluster row automatically.
//
// This is the highest-visibility surface in the dashboard: home page
// hero, day-detail page, multiple sub-cards (HeroV3, DomainPointerCard,
// ContradictionCard, TopActionCard) all read synthesis content. The
// dual-write keeps every reader path alive.
CLUSTER_REGISTRY.set("synthesis_v3", {
  name: "synthesis_v3",
  extract: extractSynthesisV3 as unknown as ClusterRegistryEntry["extract"],
  prose: proseSynthesisV3 as unknown as ClusterRegistryEntry["prose"],
  deps: depsSynthesisV3,
  payloadSchema: synthesisV3Schema,
});

/**
 * Fan-out across every registered cluster, accumulating the union of cell
 * keys that the event invalidates. Duplicate (cluster, key, scope) entries
 * are de-duped — two clusters depending on the same shared cell still only
 * emit one markStale call.
 */
export function resolveStaleCells(event: PulseEvent): CellKey[] {
  const seen = new Set<string>();
  const out: CellKey[] = [];
  for (const entry of CLUSTER_REGISTRY.values()) {
    let keys: CellKey[] = [];
    try {
      keys = entry.deps(event);
    } catch {
      // A misbehaving cluster registry entry must not break the dispatch
      // path for everyone else.
      keys = [];
    }
    for (const k of keys) {
      const scope = k.scope ?? "daily";
      const dedupe = `${entry.name}|${k.cluster}|${k.key}|${scope}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ cluster: k.cluster, key: k.key, scope });
    }
  }
  return out;
}
