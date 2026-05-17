/**
 * Optional critic-model review pass for the daily insight.
 *
 * A second model (configured via RUNNER_CRITIC_MODEL env var, e.g.
 * "gemma4:26b" or "gpt-oss:20b") reviews the prose against a German rubric
 * and reports rule violations the pattern-based verifier may miss
 * (subtle hedging gaps, S1 priority breaches phrased novelly, off-tone
 * cheerleading, ungrounded interpretation jumps).
 *
 * Off by default. Adds ~30s to a finalize when on. The orchestrator folds
 * any reported violations into the regen-with-feedback loop, so the daily
 * LLM can fix them on the next attempt.
 */

import type { DailyInsightV2 } from "@/lib/types/generated";
import { callOllama } from "../ollama.ts";

export interface CriticResult {
  /** True when the model returned an empty violations array. */
  ok: boolean;
  /** Violation strings already in German, ready to feed back to Stage 4. */
  violations: string[];
  /** "off" when the env var is absent — caller can short-circuit. */
  status: "off" | "ok" | "violations" | "skipped" | "error";
  /** Telemetry. */
  durationMs: number;
}

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    overall_ok: { type: "boolean" },
    violations: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 240 },
    },
  },
  required: ["overall_ok", "violations"],
} as const;

const CRITIC_SYSTEM = `Du bist ein strenger, knapper Reviewer für Gesundheits-Coach-Texte
auf Deutsch. Du erhältst eine fertige Tagesauswertung als JSON. Prüfe sie
gegen die folgende Rubrik und liste die Verstöße einzeln auf. Wenn alles in
Ordnung ist, setze overall_ok=true und violations=[].

RUBRIK:
1. S1-PRIORITÄT: Liegt eine S1-Beobachtung in den evidence_ids vor, MUSS sie
   in der summary zuerst genannt werden, ohne Weichmacher ("nur zur Info",
   "Datenlücke", "unsicher", "daher unklar").
2. NUMERISCHE TREUE: Jede Zahl in summary, headline, drivers[].clause oder
   drivers[].delta_text muss aus dem Input nachvollziehbar sein. Keine
   erfundenen Mediane, Z-Scores oder Prozentsätze.
3. RICHTUNGSSINN: Wenn ein driver.direction "down" ist, muss delta_text oder
   clause eine Verringerung implizieren — und umgekehrt für "up".
4. HEDGING: Hypothesen brauchen "könnte", "wirkt wie", "passt zu". Keine
   harten Kausalketten ohne Hedging.
5. AUTONOMIE: Keine Imperative ("du musst", "du sollst", "du solltest").
6. KEINE DIAGNOSTIK: Keine Befund-Sprache ("Diagnose", "leidest an", "bist
   krank"), keine Substanzempfehlungen.
7. EMPATHIE OHNE SUBSTANZ: Keine Pseudo-Cheerleading-Floskeln
   ("großartig", "super!", "ich bin stolz").

OUTPUT-CONTRACT:
- overall_ok: boolean — true nur wenn KEIN Verstoß vorliegt.
- violations: array — pro Eintrag ein Satz auf Deutsch, der den Verstoß
  benennt und den genauen Pfad/Feld angibt (z. B. "summary: erfindet 14-Tage-
  Median 113 — facts.cardio.baseline.hr_max_bpm.median ist 127").
- Maximal 8 Einträge. Kürzer = besser.
- Keine Verbesserungsvorschläge schreiben — nur die Verstöße.
`;

/**
 * Run the critic if RUNNER_CRITIC_MODEL is set. Always swallows internal
 * errors — never blocks the pipeline.
 */
export async function runCritic(daily: DailyInsightV2): Promise<CriticResult> {
  const t0 = Date.now();
  const model = process.env.RUNNER_CRITIC_MODEL?.trim();
  if (!model) {
    return { ok: true, violations: [], status: "off", durationMs: 0 };
  }

  // Trim daily payload to the prose-relevant subset. Critic doesn't need
  // surprise_insights or coaching_cards bodies — they are deterministic and
  // not part of the prose contract here.
  const trimmed = {
    abstain: daily.abstain,
    abstain_reason: daily.abstain_reason,
    headline: daily.headline,
    summary: daily.summary,
    verdict_band: daily.verdict_band,
    drivers: daily.drivers,
    affirmation: daily.affirmation,
    reflection: daily.reflection,
    action: daily.action,
    confidence: daily.confidence,
  };
  const userMsg = [
    "Bewerte den folgenden Tages-Insight gemäß der Rubrik.",
    "```json",
    JSON.stringify(trimmed, null, 2),
    "```",
    "",
    "Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, das dem Ausgabe-Schema entspricht.",
  ].join("\n");

  let raw: { content: string; totalMs: number };
  try {
    raw = await callOllama({
      model,
      system: CRITIC_SYSTEM,
      user: userMsg,
      tag: "stage6_critic",
      format: CRITIC_SCHEMA,
      options: { temperature: 0.2, num_ctx: 8192, num_predict: 1200 },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[critic] ${model} failed: ${msg}`);
    return { ok: true, violations: [], status: "error", durationMs: Date.now() - t0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.content);
  } catch (err) {
    console.warn(
      `[critic] ${model} JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: true, violations: [], status: "error", durationMs: Date.now() - t0 };
  }
  if (parsed == null || typeof parsed !== "object") {
    return { ok: true, violations: [], status: "error", durationMs: Date.now() - t0 };
  }
  const obj = parsed as { overall_ok?: unknown; violations?: unknown };
  const ok = obj.overall_ok === true;
  const violations = Array.isArray(obj.violations)
    ? obj.violations.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const status: CriticResult["status"] =
    violations.length === 0 && ok ? "ok" : violations.length > 0 ? "violations" : "skipped";
  return { ok: violations.length === 0, violations, status, durationMs: Date.now() - t0 };
}
