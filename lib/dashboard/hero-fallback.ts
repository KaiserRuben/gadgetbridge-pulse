import "server-only";
import type { DailyV3Bundle, SynthesisDomainPointer } from "@/lib/types/v3";

type Fallback = {
  headline: string;
  summary_short: string | null;
  summary_long: string | null;
};

function pickClusterFallback(bundle: DailyV3Bundle): Fallback | null {
  const candidates = [bundle.sleep, bundle.recovery, bundle.activity];
  for (const c of candidates) {
    if (c && !c.abstain && c.headline) {
      return {
        headline: c.headline,
        summary_short: c.summary_short ?? null,
        summary_long: c.summary_long ?? c.summary_short ?? null,
      };
    }
  }
  return null;
}

function rewritePointersFromClusters(
  original: readonly [SynthesisDomainPointer, SynthesisDomainPointer, SynthesisDomainPointer],
  bundle: DailyV3Bundle,
): [SynthesisDomainPointer, SynthesisDomainPointer, SynthesisDomainPointer] {
  const rewrite = (p: SynthesisDomainPointer): SynthesisDomainPointer => {
    const cluster =
      p.domain === "sleep" ? bundle.sleep : p.domain === "recovery" ? bundle.recovery : bundle.activity;
    if (!cluster || cluster.abstain) return p;
    const topKpi = cluster.kpis?.[0];
    return {
      ...p,
      kpi_value: topKpi?.value ?? p.kpi_value,
      kpi_band: topKpi?.band ?? p.kpi_band,
      callout: cluster.summary_short ?? cluster.headline ?? p.callout,
    };
  };
  return [rewrite(original[0]), rewrite(original[1]), rewrite(original[2])];
}

/**
 * Builds a v3 bundle whose synthesis is patched to surface cluster content
 * when the LLM-level synthesis abstained but at least one cluster has a real
 * insight. Idempotent — returns the original bundle if no patch is needed.
 */
export function applyHeroFallback(bundle: DailyV3Bundle): DailyV3Bundle {
  const synth = bundle.daily;
  if (!synth?.abstain) return bundle;
  const fallback = pickClusterFallback(bundle);
  if (!fallback) return bundle;
  return {
    ...bundle,
    daily: {
      ...synth,
      ...fallback,
      abstain: false,
      abstain_reason: null,
      domain_pointers: rewritePointersFromClusters(synth.domain_pointers, bundle),
    },
  };
}
