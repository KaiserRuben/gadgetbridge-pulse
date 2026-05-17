/**
 * Smoke test for the Phase 3 landing curator.
 *
 * Sequential, single Ollama call. Loads the latest available `_facts.json`
 * folder under `insights/daily/`, computes Stage A candidates, calls
 * Stage B once with a morning daypart hint, prints headline + sections +
 * also_see, then verifies the cache hit by hitting `/api/landing` over
 * HTTP (assumes `next dev -p 3030` is up).
 *
 * Run: `npx tsx runner/src/test/probe-landing-curator.ts [date]`
 *
 * The HTTP step is skipped (with a warning) if the dev server isn't
 * reachable, so the probe still functions in offline / pre-deploy mode.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.ts";
import {
  computeLandingCandidates,
  type LandingCandidate,
} from "../analyzer/landing-candidates-core.ts";
import { curateLanding } from "../analyzer/landing-curator.ts";
import {
  readCachedLanding,
  writeCachedLanding,
} from "../analyzer/landing-cache.ts";

async function findLatestDate(insightsRoot: string): Promise<string | null> {
  const dailyDir = path.join(insightsRoot, "daily");
  try {
    const entries = await readdir(dailyDir);
    return (
      entries
        .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        .sort()
        .pop() ?? null
    );
  } catch {
    return null;
  }
}

function fmtZ(z: number | null): string {
  return z === null ? "  null" : z.toFixed(2).padStart(6, " ");
}

function topByZ(c: LandingCandidate[], n: number): LandingCandidate[] {
  return [...c]
    .sort(
      (a, b) => Math.abs(b.z_score ?? 0) - Math.abs(a.z_score ?? 0),
    )
    .slice(0, n);
}

interface LandingApiResponse {
  ok: boolean;
  layout?: unknown;
  cache?: "hit" | "miss";
  error?: string;
}

async function fetchApiLanding(
  date: string,
): Promise<{ status: number; body: LandingApiResponse; cache: string | null; latencyMs: number } | null> {
  const url = `http://localhost:3030/api/landing?date=${encodeURIComponent(date)}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let body: LandingApiResponse;
    try {
      body = JSON.parse(text) as LandingApiResponse;
    } catch {
      body = { ok: false, error: text.slice(0, 200) };
    }
    return {
      status: res.status,
      body,
      cache: res.headers.get("x-cache"),
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[probe] /api/landing not reachable (${msg}), skipping HTTP step`);
    return null;
  }
}

async function main(): Promise<void> {
  const date =
    process.argv[2] ?? (await findLatestDate(config.insightsRoot));
  if (!date) {
    console.error("[probe] no daily insights found; pass a date as argv[2]");
    process.exit(2);
  }

  console.log(`[probe] anchor date: ${date}`);
  console.log(`[probe] insightsRoot: ${config.insightsRoot}`);

  // ── Stage A ────────────────────────────────────────────────────────
  const tA0 = Date.now();
  const candidates = await computeLandingCandidates(config.insightsRoot, date);
  const tA = Date.now() - tA0;
  console.log(
    `[probe] stage-A: ${candidates.length} candidates in ${tA} ms`,
  );

  const counts = candidates.reduce(
    (acc, c) => {
      acc[c.surprise_label] = (acc[c.surprise_label] ?? 0) + 1;
      acc.byDomain[c.domain] = (acc.byDomain[c.domain] ?? 0) + 1;
      return acc;
    },
    {
      high: 0,
      medium: 0,
      low: 0,
      byDomain: {} as Record<string, number>,
    },
  );
  console.log(
    `[probe]   surprise: high=${counts.high} medium=${counts.medium} low=${counts.low}`,
  );
  console.log(`[probe]   per domain: ${JSON.stringify(counts.byDomain)}`);

  console.log("[probe] top 10 by |z|:");
  for (const c of topByZ(candidates, 10)) {
    console.log(
      `[probe]   z=${fmtZ(c.z_score)} ${c.surprise_label.padEnd(6)} ${c.domain.padEnd(8)} ${c.timeframe.padEnd(12)} ${c.metric_label_de.padEnd(20)} ${c.evidence_de}`,
    );
  }

  // ── Stage B (single Ollama call) ───────────────────────────────────
  // Force a cache MISS by deleting any pre-existing cached file? No — the
  // spec says re-call should hit the cache. So we honour any pre-existing
  // cache. The probe's first call still produces output even on hit.
  const cached = await readCachedLanding(date, config.insightsRoot);
  let firstLatencyMs: number;
  let cacheState: "hit" | "miss";
  let layout;
  if (cached) {
    console.log("[probe] stage-B: cache HIT — skipping Ollama, using cached layout");
    layout = cached;
    firstLatencyMs = 0;
    cacheState = "hit";
  } else {
    console.log(
      `[probe] stage-B: cache MISS — calling Ollama at ${config.ollamaUrl} (model ${config.model})`,
    );
    const tB0 = Date.now();
    layout = await curateLanding(
      candidates,
      { dateKey: date, localHourGuess: 8 }, // morning bias
      { ollamaUrl: config.ollamaUrl, timeoutMs: 240_000 },
    );
    firstLatencyMs = Date.now() - tB0;
    await writeCachedLanding(layout, config.insightsRoot);
    cacheState = "miss";
    console.log(`[probe] stage-B: latency ${(firstLatencyMs / 1000).toFixed(2)} s`);
  }

  console.log(`[probe] cache state for first call: ${cacheState}`);
  console.log("[probe] HEADLINE:");
  console.log(`[probe]   key:      ${layout.headline.candidate_key}`);
  console.log(`[probe]   title:    ${layout.headline.title_de}`);
  console.log(`[probe]   body:     ${layout.headline.body_de}`);
  console.log(
    `[probe]   chart:    ${layout.headline.chart_hint.domain}/${layout.headline.chart_hint.metric}`,
  );
  console.log(`[probe]   link_to:  ${layout.headline.link_to}`);

  console.log("[probe] SECTIONS:");
  for (const dom of ["sleep", "heart", "body", "activity"] as const) {
    const s = layout.sections[dom];
    console.log(`[probe]   ${dom.padEnd(8)} → ${s.primary_candidate_key ?? "(null)"}`);
    console.log(`[probe]            ${s.annotation_de}`);
    console.log(`[probe]            link: ${s.link_to}`);
  }

  if (layout.also_see && layout.also_see.length > 0) {
    console.log("[probe] ALSO_SEE:");
    for (const a of layout.also_see) {
      console.log(`[probe]   - ${a.label_de} → ${a.href}`);
    }
  } else {
    console.log("[probe] ALSO_SEE: (none)");
  }

  // ── schema sanity ──────────────────────────────────────────────────
  const sv = layout.schema_version === "landing/v1";
  const dateOk = layout.date === date;
  const sectionsOk =
    typeof layout.sections === "object" &&
    layout.sections.sleep &&
    layout.sections.heart &&
    layout.sections.body &&
    layout.sections.activity;
  const headlineOk =
    typeof layout.headline?.candidate_key === "string" &&
    typeof layout.headline?.title_de === "string" &&
    typeof layout.headline?.body_de === "string";
  console.log(
    `[probe] schema check: schema_version=${sv} date=${dateOk} sectionsOk=${!!sectionsOk} headlineOk=${headlineOk}`,
  );
  if (!sv || !dateOk || !sectionsOk || !headlineOk) {
    console.error("[probe] schema validation FAILED");
    process.exit(1);
  }

  // ── HTTP cache-hit verification ────────────────────────────────────
  console.log("[probe] hitting /api/landing for cache-hit verification...");
  const httpRes = await fetchApiLanding(date);
  if (!httpRes) {
    console.log("[probe] (skipped) — start `npm run dev` to verify the route");
  } else {
    console.log(
      `[probe] HTTP ${httpRes.status} cache=${httpRes.cache ?? "?"} latency=${httpRes.latencyMs} ms`,
    );
    if (httpRes.status !== 200 || httpRes.body.ok !== true) {
      console.error(
        `[probe] /api/landing failed: ${JSON.stringify(httpRes.body).slice(0, 200)}`,
      );
      process.exit(1);
    }
    if (cacheState === "miss" && httpRes.cache !== "hit") {
      console.error(
        `[probe] expected cache=hit on second call, got cache=${httpRes.cache ?? "?"}`,
      );
      process.exit(1);
    }
    console.log(
      `[probe] latency delta: first=${firstLatencyMs} ms → http(cache=${httpRes.cache})=${httpRes.latencyMs} ms`,
    );
  }

  console.log("[probe] OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("[probe] failed:", err);
  process.exit(1);
});
