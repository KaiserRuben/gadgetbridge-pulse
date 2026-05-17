/**
 * Sleep-domain rule runners.
 *
 * Each function is pure: `(input: RuleEngineInput) => Observation[]`.
 * Reads `input.facts.sleep` + `input.history.*` and emits at most a
 * handful of observations per domain.
 *
 * References:
 *   - Sleep Regularity Index: Windred et al. 2024 (Nature) — bands
 *     <60 (poor), 60–74 (fair), 75–87.5 (good), ≥87.5 (excellent).
 *     We can compute SRI only when Stage 0 supplies the per-night
 *     sleep/wake minute vectors; in P2 we surface what's available
 *     from the history buffer (TST + bedtime variance proxy).
 *   - Sleep efficiency: AASM/CDC clinical thresholds (<85% sub-optimal,
 *     <75% red-flag).
 *   - Sleep latency: standard >30 min sub-optimal, >60 min insomnia
 *     marker, <5 min sleep-deprivation indicator.
 *   - Sleep architecture: combined deep+REM minutes is a robust
 *     compound that avoids the noisy per-stage classifier.
 *   - Sleep apnea via O2-desat events: count + max severity proxy.
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import {
  median,
  mad,
  zRobust,
  rollingMedianMAD,
  trailingConsecutive,
  countLastN,
  compact,
} from "../stats.ts";
import { buildObservation, directionFromZ, factor, formatDeltaDe } from "../build.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleepWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

function signalQualityScore(ok: boolean): number {
  return ok ? 1.0 : 0.3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep regularity (SRI proxy)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approximation of the Sleep Regularity Index using bedtime variance over
 * the last 7 nights. True SRI requires per-minute sleep/wake vectors which
 * the Mi Band data does not directly provide; until Stage 0 derives them,
 * we use the standard deviation of bedtime-minute-from-midnight as a proxy
 * and map it to the same band thresholds.
 *
 * Bands (mirrored from Windred 2024):
 *   <60     poor         → S2 watch
 *   60–74   fair         → S3 nudge
 *   75–87.5 good         → info
 *   ≥87.5   excellent    → info
 */
export function runSleepRegularity(input: RuleEngineInput): Observation[] {
  const bedtimes = input.history.bedtime_min_7d ?? [];
  const a = compact(bedtimes);
  if (a.length < 5) return [];

  // SD of bedtime in minutes; map: 0 min → 100, 60 min → 75, 120 min → 50.
  // Linear: SRI ≈ 100 − sd_min × (100 − 50) / 120.
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  let acc = 0;
  for (const x of a) acc += (x - m) * (x - m);
  const sd = Math.sqrt(acc / (a.length - 1));
  const sri = Math.max(0, Math.min(100, 100 - sd * (50 / 120)));

  const win = sleepWindow(input);
  const sq = input.facts.sleep?.signal_quality.ok ?? false;
  const factors = [
    factor(
      "baseline_window_coverage",
      0.4,
      Math.min(1, a.length / 7),
      `${a.length} of 7 bedtime samples`,
    ),
    factor("signal_quality", 0.3, signalQualityScore(sq), sq ? "Signal OK" : "Signal degraded"),
    factor("persistence_gate", 0.3, 0.7, "7-night rolling SD"),
  ];

  if (sri < 60) {
    return [
      buildObservation({
        id: "sleep_regularity_poor",
        domain: "sleep",
        severity: "watch",
        tier: "S2",
        metric_id: "sleep.regularity_index",
        evidence: ["sleep.bedtime_min"],
        window: win,
        text_for_llm: `Sleep regularity index ≈${sri.toFixed(0)} (bedtime SD ${sd.toFixed(0)} min over 7 nights). Below 60 — irregular schedule range.`,
        direction: "down",
        confidence_factors: factors,
      }),
    ];
  }
  if (sri < 75) {
    return [
      buildObservation({
        id: "sleep_regularity_fair",
        domain: "sleep",
        severity: "info",
        tier: "S3",
        metric_id: "sleep.regularity_index",
        evidence: ["sleep.bedtime_min"],
        window: win,
        text_for_llm: `Sleep regularity index ≈${sri.toFixed(0)} (bedtime SD ${sd.toFixed(0)} min over 7 nights). Fair range.`,
        direction: "flat",
        confidence_factors: factors,
      }),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Total sleep time (TST)
// ─────────────────────────────────────────────────────────────────────────────

export function runSleepTotalTime(input: RuleEngineInput): Observation[] {
  const sleep = input.facts.sleep;
  if (!sleep) return [];
  const tst = sleep.metrics.tst_min;
  if (typeof tst !== "number" || !Number.isFinite(tst)) return [];

  const hist = input.history.tst_min_30d ?? [];
  const { median: med, mad: madVal, n } = rollingMedianMAD(hist, 30);
  const win = sleepWindow(input);
  const sq = sleep.signal_quality.ok;

  // Absolute red-flag: TST < 4h on a single night (severe deprivation).
  if (tst < 240) {
    return [
      buildObservation({
        id: "sleep_total_time_critical",
        domain: "sleep",
        severity: "warn",
        tier: "S2",
        metric_id: "sleep.tst_min",
        evidence: ["sleep.tst_min"],
        window: win,
        text_for_llm: `Total sleep time ${Math.round(tst)} min (<240 min). Severe single-night deprivation.`,
        delta_text: Number.isFinite(med)
          ? formatDeltaDe(tst, med, "min", "30-Tage")
          : null,
        direction: "down",
        confidence_factors: [
          factor("baseline_window_coverage", 0.2, Math.min(1, n / 14), `n=${n}`),
          factor("signal_quality", 0.3, signalQualityScore(sq), "Single-night absolute"),
          factor("persistence_gate", 0.5, 1.0, "Absolute threshold"),
        ],
      }),
    ];
  }

  // Persistence-gated z-score check using the locked tier ladder.
  if (n < 14 || !Number.isFinite(med) || !Number.isFinite(madVal) || madVal === 0) {
    return [];
  }
  const z = zRobust(tst, med, madVal);

  // 3-consec >+1.5σ (down direction in TST) OR 5/7 days outside ±1σ.
  const zHist = hist.map((x) =>
    typeof x === "number" && Number.isFinite(x) ? zRobust(x, med, madVal) : 0,
  );
  const consecLow = trailingConsecutive(zHist, (zi) => zi <= -1.5);
  const last7Low = countLastN(zHist, 7, (zi) => zi <= -1);

  if (consecLow >= 3 || last7Low.hits >= 5) {
    return [
      buildObservation({
        id: "sleep_total_time_low_pattern",
        domain: "sleep",
        severity: "watch",
        tier: "S2",
        metric_id: "sleep.tst_min",
        evidence: ["sleep.tst_min"],
        window: win,
        text_for_llm: `TST ${Math.round(tst)} min (${z.toFixed(1)} robust SD vs 30d median ${med.toFixed(0)} min). Pattern of low TST: ${consecLow}-consec or ${last7Low.hits}/${last7Low.total} below baseline.`,
        delta_text: formatDeltaDe(tst, med, "min", "30-Tage"),
        direction: directionFromZ(z),
        confidence_factors: [
          factor("baseline_window_coverage", 0.4, Math.min(1, n / 30), `n=${n}/30`),
          factor("signal_quality", 0.3, signalQualityScore(sq), sq ? "OK" : "Degraded"),
          factor(
            "persistence_gate",
            0.3,
            consecLow >= 3 ? 1.0 : 0.85,
            `consec=${consecLow}, 5/7=${last7Low.hits}/${last7Low.total}`,
          ),
        ],
      }),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep efficiency
// ─────────────────────────────────────────────────────────────────────────────

export function runSleepEfficiency(input: RuleEngineInput): Observation[] {
  const sleep = input.facts.sleep;
  if (!sleep) return [];
  const eff = sleep.metrics.sleep_efficiency_pct;
  if (typeof eff !== "number" || !Number.isFinite(eff)) return [];
  const win = sleepWindow(input);
  const sq = sleep.signal_quality.ok;

  // Absolute single-night red-flag.
  if (eff < 75) {
    return [
      buildObservation({
        id: "sleep_efficiency_low_critical",
        domain: "sleep",
        severity: "warn",
        tier: "S2",
        metric_id: "sleep.sleep_efficiency_pct",
        evidence: ["sleep.sleep_efficiency_pct"],
        window: win,
        text_for_llm: `Sleep efficiency ${eff.toFixed(0)}% (<75%). Single-night red-flag.`,
        direction: "down",
        confidence_factors: [
          factor("baseline_window_coverage", 0.2, 0.5, "Absolute threshold"),
          factor("signal_quality", 0.4, signalQualityScore(sq), sq ? "OK" : "Degraded"),
          factor("persistence_gate", 0.4, 1.0, "Absolute"),
        ],
      }),
    ];
  }

  // Persisted <85% over 3 of last 5 nights.
  const hist = input.history.sleep_efficiency_pct_30d ?? [];
  const last5 = countLastN(hist, 5, (x) => typeof x === "number" && x !== null && x < 85);
  if (last5.total >= 5 && last5.hits >= 3 && eff < 85) {
    return [
      buildObservation({
        id: "sleep_efficiency_low_pattern",
        domain: "sleep",
        severity: "watch",
        tier: "S2",
        metric_id: "sleep.sleep_efficiency_pct",
        evidence: ["sleep.sleep_efficiency_pct"],
        window: win,
        text_for_llm: `Sleep efficiency ${eff.toFixed(0)}% (<85%) on ${last5.hits} of last ${last5.total} nights.`,
        direction: "down",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, Math.min(1, last5.total / 5), `n=${last5.total}/5`),
          factor("signal_quality", 0.3, signalQualityScore(sq), sq ? "OK" : "Degraded"),
          factor("persistence_gate", 0.4, last5.hits / 5, `${last5.hits}/${last5.total}`),
        ],
      }),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep latency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sleep latency = first-bedtime to first-onset (minutes). The current
 * facts schema does not expose latency directly; we derive a proxy from
 * `awake_min` if it is the only awakeness in the first quartile of the
 * night (Stage 0 will eventually compute true onset latency). For now,
 * trigger only on history-buffer values; no current-night call.
 */
export function runSleepLatency(input: RuleEngineInput): Observation[] {
  const hist = input.history.sleep_latency_min_30d ?? [];
  const last = compact(hist).at(-1);
  if (typeof last !== "number") return [];
  const win = sleepWindow(input);
  const sq = input.facts.sleep?.signal_quality.ok ?? false;

  // Absolute single-night flag: >60 min latency.
  if (last > 60) {
    return [
      buildObservation({
        id: "sleep_latency_high_critical",
        domain: "sleep",
        severity: "warn",
        tier: "S2",
        metric_id: "sleep.latency_min",
        evidence: ["sleep.latency_min"],
        window: win,
        text_for_llm: `Sleep onset latency ${Math.round(last)} min (>60 min). Insomnia signal.`,
        direction: "up",
        confidence_factors: [
          factor("baseline_window_coverage", 0.2, 0.5, "Absolute threshold"),
          factor("signal_quality", 0.4, signalQualityScore(sq), "Latency proxy"),
          factor("persistence_gate", 0.4, 1.0, "Absolute"),
        ],
      }),
    ];
  }

  // Sleep-deprivation marker: very fast onset (<5 min) is unusual.
  if (last < 5) {
    return [
      buildObservation({
        id: "sleep_latency_too_fast",
        domain: "sleep",
        severity: "info",
        tier: "S3",
        metric_id: "sleep.latency_min",
        evidence: ["sleep.latency_min"],
        window: win,
        text_for_llm: `Sleep onset <5 min — possible sleep-debt indicator (immediate onset).`,
        direction: "down",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, 0.5, "Latency proxy"),
          factor("signal_quality", 0.3, signalQualityScore(sq), ""),
          factor("persistence_gate", 0.4, 0.5, "Single-night"),
        ],
      }),
    ];
  }

  // Persistence: 3 of last 5 with >30 min latency.
  const last5 = countLastN(hist, 5, (x) => typeof x === "number" && x !== null && x > 30);
  if (last5.total >= 5 && last5.hits >= 3 && last > 30) {
    return [
      buildObservation({
        id: "sleep_latency_high_pattern",
        domain: "sleep",
        severity: "watch",
        tier: "S2",
        metric_id: "sleep.latency_min",
        evidence: ["sleep.latency_min"],
        window: win,
        text_for_llm: `Sleep latency >30 min on ${last5.hits} of last ${last5.total} nights.`,
        direction: "up",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, Math.min(1, last5.total / 5), `n=${last5.total}/5`),
          factor("signal_quality", 0.3, signalQualityScore(sq), ""),
          factor("persistence_gate", 0.4, last5.hits / 5, `${last5.hits}/${last5.total}`),
        ],
      }),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep apnea
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apnea events (O2-desat-style). The schema does not yet expose a per-night
 * count — Stage 0 will populate `history.apnea_events_per_night_14d` and
 * `history.apnea_max_level_14d`. The runner gates on those.
 *
 *  - S1: tonight count ≥5 AND max_level ≥2. Safety-critical, never suppressed.
 *  - S2: 3+ events/night for 3 consecutive nights.
 */
export function runSleepApnea(input: RuleEngineInput): Observation[] {
  const counts = input.history.apnea_events_per_night_14d ?? [];
  const levels = input.history.apnea_max_level_14d ?? [];
  const lastCount = compact(counts).at(-1);
  const lastLevel = compact(levels).at(-1);
  if (typeof lastCount !== "number" || typeof lastLevel !== "number") return [];

  const win = sleepWindow(input);
  const sq = input.facts.sleep?.signal_quality.ok ?? false;
  const out: Observation[] = [];

  // S1: tonight count ≥5 AND max_level ≥2.
  if (lastCount >= 5 && lastLevel >= 2) {
    out.push(
      buildObservation({
        id: "sleep_apnea_safety",
        domain: "sleep",
        severity: "critical",
        tier: "S1",
        metric_id: "sleep.apnea_events",
        evidence: ["sleep.apnea_events", "sleep.apnea_max_level"],
        window: win,
        text_for_llm: `Apnea-like events: ${lastCount} tonight at max severity ${lastLevel}. Persistent or severe — clinical consultation suggested.`,
        direction: "up",
        confidence_factors: [
          factor("baseline_window_coverage", 0.2, 0.7, "Single-night absolute"),
          factor("signal_quality", 0.4, signalQualityScore(sq), sq ? "OK" : "Proxy desat events"),
          factor("persistence_gate", 0.4, 1.0, "Absolute compound"),
        ],
      }),
    );
    return out;
  }

  // S2: 3+ events per night for 3 consecutive nights.
  const consec = trailingConsecutive(
    counts,
    (x): x is number => typeof x === "number" && x !== null && x >= 3,
  );
  if (consec >= 3) {
    out.push(
      buildObservation({
        id: "sleep_apnea_pattern",
        domain: "sleep",
        severity: "warn",
        tier: "S2",
        metric_id: "sleep.apnea_events",
        evidence: ["sleep.apnea_events"],
        window: win,
        text_for_llm: `Apnea-like events ≥3/night for ${consec} consecutive nights.`,
        direction: "up",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, Math.min(1, consec / 3), `consec=${consec}`),
          factor("signal_quality", 0.3, signalQualityScore(sq), ""),
          factor("persistence_gate", 0.4, 1.0, `${consec}-consec`),
        ],
      }),
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep architecture (deep + REM combined)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combined deep+REM minutes. Uses the personal robust baseline. The deep
 * vs REM split is too noisy at the per-night level on Mi Band classifiers,
 * so we evaluate the sum (a robust proxy for "restorative time").
 */
export function runSleepArchitecture(input: RuleEngineInput): Observation[] {
  const sleep = input.facts.sleep;
  if (!sleep) return [];
  const deep = sleep.metrics.deep_min;
  const rem = sleep.metrics.rem_min;
  if (typeof deep !== "number" || typeof rem !== "number") return [];
  const sum = deep + rem;

  const hist = input.history.deep_plus_rem_min_14d ?? [];
  const { median: med, mad: madVal, n } = rollingMedianMAD(hist, 14);
  if (n < 7 || !Number.isFinite(med) || !Number.isFinite(madVal) || madVal === 0) {
    return [];
  }
  const z = zRobust(sum, med, madVal);
  const zHist = hist.map((x) =>
    typeof x === "number" && Number.isFinite(x) ? zRobust(x, med, madVal) : 0,
  );
  const consec = trailingConsecutive(zHist, (zi) => zi <= -1.5);
  if (consec < 3) return [];

  const win = sleepWindow(input);
  const sq = sleep.signal_quality.ok;
  return [
    buildObservation({
      id: "sleep_architecture_low_restorative",
      domain: "sleep",
      severity: "watch",
      tier: "S2",
      metric_id: "sleep.deep_plus_rem_min",
      evidence: ["sleep.deep_min", "sleep.rem_min"],
      window: win,
      text_for_llm: `Deep+REM ${Math.round(sum)} min (${z.toFixed(1)} robust SD vs 14d median ${med.toFixed(0)} min) for ${consec}-consec nights below −1.5σ.`,
      delta_text: formatDeltaDe(sum, med, "min", "14-Tage"),
      direction: directionFromZ(z),
      confidence_factors: [
        factor("baseline_window_coverage", 0.4, Math.min(1, n / 14), `n=${n}/14`),
        factor("signal_quality", 0.3, signalQualityScore(sq), sq ? "OK" : "Degraded"),
        factor("persistence_gate", 0.3, 1.0, `${consec}-consec`),
      ],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level export
// ─────────────────────────────────────────────────────────────────────────────

export function runSleepDomain(input: RuleEngineInput): Observation[] {
  return [
    ...runSleepRegularity(input),
    ...runSleepTotalTime(input),
    ...runSleepEfficiency(input),
    ...runSleepLatency(input),
    ...runSleepApnea(input),
    ...runSleepArchitecture(input),
  ];
}
