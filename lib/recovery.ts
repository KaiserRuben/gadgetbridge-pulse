import "server-only";
import type { FactsBundleV2 } from "./types/generated";
import type { WorkoutSummary } from "./queries/workouts";

/**
 * Recovery view: a transparent, deterministic 0..100 score derived from the
 * facts bundle and recent workouts. Not a medical reading — a daily-load
 * gauge that surfaces when the body is unlikely to absorb a hard session.
 *
 * Design choices:
 *   - Anchor at 80 (assumed "normal" recovery without negative drivers).
 *   - Each negative driver subtracts a fixed weight; nothing is additive in
 *     the positive direction (we don't reward low RHR / great sleep — that
 *     just keeps the baseline of 80).
 *   - Drivers are short German clauses suitable for inline display.
 *   - `recoveryHoursOpen`: residual time (h) the watch still asks the user
 *     to recover, summed across recent workouts and clamped >= 0.
 *
 * Bands: ready ≥ 70, moderate 40..69, fatigued < 40.
 */

export type RecoveryBand = "ready" | "moderate" | "fatigued";

export type RecoveryView = {
  score: number;
  band: RecoveryBand;
  drivers: string[];
  recoveryHoursOpen: number | null;
};

/**
 * recentWorkouts must contain workouts in the last ~72h (caller decides the
 * window). We use them to estimate residual recovery hours and acute load.
 *
 * `yest` is yesterday's facts bundle, used to infer overnight signals when
 * `facts` lacks HRV.
 */
export function computeRecovery(
  facts: FactsBundleV2 | null,
  recentWorkouts: WorkoutSummary[],
  yest: FactsBundleV2 | null,
): RecoveryView | null {
  if (!facts) return null;

  const drivers: string[] = [];
  let score = 80;

  // 1. RHR vs baseline (median of bundle baseline, fallback to yesterday).
  const rhr = facts.cardio?.metrics?.rhr_day_bpm ?? null;
  const rhrBaseline = readBaselineMedian(facts.cardio?.baseline, "rhr_day_bpm");
  if (rhr != null && rhrBaseline != null) {
    const delta = rhr - rhrBaseline;
    if (delta >= 8) {
      score -= 18;
      drivers.push(`RHR +${Math.round(delta)} bpm`);
    } else if (delta >= 4) {
      score -= 10;
      drivers.push(`RHR +${Math.round(delta)} bpm`);
    }
  }

  // 2. Total sleep time (TST) — penalize short sleep.
  const tst = facts.sleep?.metrics?.tst_min ?? null;
  if (tst != null) {
    if (tst < 360) {
      score -= 18;
      drivers.push(`TST ${fmtTst(tst)}`);
    } else if (tst < 420) {
      score -= 10;
      drivers.push(`TST ${fmtTst(tst)}`);
    }
  } else if (yest?.sleep?.metrics?.tst_min != null && yest.sleep.metrics.tst_min < 360) {
    score -= 8;
    drivers.push(`TST gestern ${fmtTst(yest.sleep.metrics.tst_min)}`);
  }

  // 3. Sleep efficiency.
  const eff = facts.sleep?.metrics?.sleep_efficiency_pct ?? null;
  if (eff != null && eff < 80) {
    score -= eff < 70 ? 12 : 6;
    drivers.push(`Effizienz ${Math.round(eff)} %`);
  }

  // 4. Open recovery hours from recent workouts (Huawei-reported).
  const nowSec = Math.floor(Date.now() / 1000);
  let recoveryHoursOpen = 0;
  let hasAnyRecovery = false;
  for (const w of recentWorkouts) {
    if (w.recoveryHours == null || w.recoveryHours <= 0) continue;
    hasAnyRecovery = true;
    const elapsedH = Math.max(0, (nowSec - w.endTs) / 3600);
    const remaining = Math.max(0, w.recoveryHours - elapsedH);
    recoveryHoursOpen += remaining;
  }
  recoveryHoursOpen = +recoveryHoursOpen.toFixed(1);

  if (recoveryHoursOpen >= 24) {
    score -= 18;
    drivers.push(`${Math.round(recoveryHoursOpen)} h Erholung offen`);
  } else if (recoveryHoursOpen >= 8) {
    score -= 10;
    drivers.push(`${Math.round(recoveryHoursOpen)} h Erholung offen`);
  }

  // 5. Recent workout load (sum across the recent window, hard cutoff).
  const loadSum = recentWorkouts.reduce(
    (acc, w) => acc + (w.workoutLoad ?? 0),
    0,
  );
  if (loadSum >= 250) {
    score -= 12;
    drivers.push(`Last ${loadSum}`);
  } else if (loadSum >= 150) {
    score -= 6;
    drivers.push(`Last ${loadSum}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band: RecoveryBand =
    score >= 70 ? "ready" : score >= 40 ? "moderate" : "fatigued";

  return {
    score,
    band,
    drivers,
    recoveryHoursOpen: hasAnyRecovery ? recoveryHoursOpen : null,
  };
}

export function recoveryBandLabel(band: RecoveryBand): string {
  return band === "ready" ? "bereit" : band === "moderate" ? "moderat" : "ermüdet";
}

export function recoveryBandTone(
  band: RecoveryBand,
): "up" | "s2" | "down" {
  return band === "ready" ? "up" : band === "moderate" ? "s2" : "down";
}

// ── helpers ──────────────────────────────────────────────────────────────

function readBaselineMedian(
  baseline: FactsBundleV2["cardio"]["baseline"],
  key: string,
): number | null {
  if (!baseline) return null;
  const entry = baseline[key];
  if (!entry || typeof entry.median !== "number") return null;
  return entry.median;
}

function fmtTst(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}
