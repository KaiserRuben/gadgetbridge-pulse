/**
 * Signal-quality classification per domain.
 *
 * Thresholds (locked, from rule engine architect):
 *   - HRV     : <3 samples OR median skin_temp <26°C OR motion artifact
 *   - RHR     : no SWS (<240 min sleep) OR <5 valid samples
 *   - Sleep   : TIB <180 min OR coverage <80%
 *   - SpO2    : <5 valid samples
 *   - Stress  : <10 valid daytime samples
 *   - SkinTemp: <30 valid samples OR median <26°C
 *
 * Returns { ok, issues } per domain. `ok=true` ⇒ no issues. The list of
 * issues becomes part of facts.json; rule engine uses it to drop or
 * downgrade observations from poor-signal domains.
 */

import type { SignalQuality } from "@/lib/types/generated";
import type { SleepFactsRaw } from "./queries/sleep.ts";
import type { CardioFactsRaw } from "./queries/cardio.ts";
import type { ActivityFactsRaw } from "./queries/activity.ts";
import type { StressFactsRaw } from "./queries/stress.ts";
import type { BodyFactsRaw } from "./queries/body.ts";

export type Domain = "sleep" | "cardio" | "activity" | "stress" | "body";

export interface SignalQualityInputs {
  sleep: SleepFactsRaw;
  cardio: CardioFactsRaw;
  activity: ActivityFactsRaw;
  stress: StressFactsRaw;
  body: BodyFactsRaw;
}

export function computeSignalQuality(domain: Domain, inputs: SignalQualityInputs): SignalQuality {
  const issues: string[] = [];

  switch (domain) {
    case "sleep": {
      const tib = inputs.sleep.tibMin;
      const cov = inputs.sleep.coveragePct;
      if (tib !== null && tib < 180) issues.push("tib_below_180min");
      if (cov !== null && cov < 80) issues.push("coverage_below_80pct");
      // Sleep is also gated on stage-row presence at all.
      if (inputs.sleep.rowCount === 0) issues.push("no_stage_rows");
      break;
    }
    case "cardio": {
      // RHR-related: requires SWS. We gate on "TST≥240" (SWS proxy) AND
      // ≥5 valid HR samples. If we have neither, mark degraded.
      if (inputs.cardio.hrRowCount < 5) issues.push("hr_samples_below_5");
      const tst = inputs.sleep.metrics.tst_min;
      if (tst !== null && tst < 240) issues.push("no_sws_window");
      // HRV-derived signal is part of cardio domain too.
      if (inputs.cardio.hrvSamples > 0 && inputs.cardio.hrvSamples < 3) {
        issues.push("hrv_samples_below_3");
      }
      // SpO2 sub-check.
      if (inputs.cardio.spo2RowCount > 0 && inputs.cardio.spo2RowCount < 5) {
        issues.push("spo2_samples_below_5");
      }
      // Skin-temp coupling — HRV is unreliable when wrist is cold.
      const tempMed = inputs.body.tempMedianC;
      if (tempMed !== null && tempMed < 26) issues.push("skin_temp_below_26c");
      break;
    }
    case "activity": {
      // Activity always has data when device is worn — only flag when no rows.
      if (inputs.activity.rowCount === 0) issues.push("no_activity_rows");
      break;
    }
    case "stress": {
      if (inputs.stress.daytimeSamples < 10) issues.push("daytime_samples_below_10");
      break;
    }
    case "body": {
      if (inputs.body.tempSamples < 30) issues.push("temp_samples_below_30");
      const tempMed = inputs.body.tempMedianC;
      if (tempMed !== null && tempMed < 26) issues.push("skin_temp_below_26c");
      break;
    }
  }

  return { ok: issues.length === 0, issues };
}
