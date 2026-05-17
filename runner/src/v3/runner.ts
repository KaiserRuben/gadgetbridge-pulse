/**
 * Generic v3 use-case runner.
 *
 * Wraps callOllama + validateInsight + retry loop. Used by sleep, recovery,
 * activity and synthesis use cases.
 *   - schema-enforced via Ollama `format` (grammar-constrained generation)
 *   - lenient JSON extractor kept as belt-and-braces for stray tokens
 *   - retry with feedback injection on grounding failure
 *
 * Note: schema enforcement requires `think` to NOT be `false` on qwen3.6 —
 * setting `think: false` silently bypasses the grammar engine. See
 * `../ollama.ts` (no `think` field sent → default thinking applies).
 */

import { callOllama } from "../ollama.ts";
import { log } from "../logger.ts";
import { config } from "../config.ts";
import { validateInsight, buildFeedback, makeAjv } from "./validate.ts";
import type { ValidationResult } from "./validate.ts";

export interface UseCaseRunOptions {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  schema: object;
  /** The packager output. Used for numeric grounding check. */
  pkg: unknown;
  /** Field-manifest appendix to inject after the system prompt. */
  manifest: string;
  /** Max attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Override Ollama options. */
  ollamaOptions?: Record<string, unknown>;
  /** Tag used in log lines (e.g. "sleep", "recovery", "activity"). */
  tag?: string;
  /**
   * Skip Ollama's grammar-constrained format mode and ask for plain
   * `format: "json"` instead. Ajv still validates post-hoc. Used by the
   * training cluster, whose schema combines `anyOf`/nullable nested objects
   * that Ollama's vocab builder rejects with "failed to load model
   * vocabulary required for format".
   */
  formatMode?: "schema" | "json";
}

export interface UseCaseRunResult {
  ok: boolean;
  attempts: number;
  insight: unknown;
  validation: ValidationResult;
  totalMs: number;
  promptTokens: number;
  evalTokens: number;
  endpoint: string;
  errors: string[];
}

const TEMPERATURES = [0.2, 0.15, 0.1];

export async function runUseCase(opts: UseCaseRunOptions): Promise<UseCaseRunResult> {
  const ajv = makeAjv();
  const tag = opts.tag ?? "v3";
  const maxAttempts = opts.maxAttempts ?? 3;
  const model = opts.model ?? config.model;

  const systemBase = `${opts.systemPrompt}\n\n${opts.manifest}`;

  let lastResult: ValidationResult | null = null;
  let totalMs = 0;
  let promptTokens = 0;
  let evalTokens = 0;
  let endpoint = "";
  const errors: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const temperature = TEMPERATURES[attempt] ?? 0.1;
    const system =
      attempt === 0 || !lastResult ? systemBase : `${systemBase}\n\n${buildFeedback(lastResult)}`;

    const t0 = Date.now();
    let raw = "";
    try {
      const formatPayload: unknown =
        opts.formatMode === "json" ? "json" : opts.schema;
      const res = await callOllama({
        model,
        system,
        user: opts.userPrompt,
        tag: `v3:${tag} a${attempt + 1}`,
        format: formatPayload,
        options: {
          temperature,
          num_ctx: 32768,
          /**
           * qwen3.6 thinking can eat 2-4k tokens before any content. 4000
           * empirically yields `done_reason: length` with content="" — see
           * 2026-05-15 v3:sleep 2026-05-13 run (out=4000, JSON.parse: empty).
           * 16000 gives generous headroom for long thinking + full insight
           * (~2-3k content tokens) without re-hitting the cap.
           */
          num_predict: 16000,
          ...(opts.ollamaOptions ?? {}),
        },
      });
      raw = res.content;
      totalMs += res.totalMs;
      promptTokens += res.promptTokens;
      evalTokens += res.evalTokens;
      endpoint = res.endpoint;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`attempt ${attempt + 1}: HTTP ${msg}`);
      log.warn(`v3:${tag}`, `attempt ${attempt + 1}/${maxAttempts} HTTP: ${msg.slice(0, 160)}`);
      totalMs += Date.now() - t0;
      continue;
    }

    const result = validateInsight(raw, opts.pkg, { schema: opts.schema, ajv });
    lastResult = result;

    if (result.schemaWarnings.length > 0) {
      log.warn(`v3:${tag}`, `attempt ${attempt + 1}/${maxAttempts} length (${result.schemaWarnings.length}) — ${result.schemaWarnings[0]}`);
    }

    if (result.ok) {
      log.info(`v3:${tag}`, `ok attempt=${attempt + 1} ${totalMs}ms in=${promptTokens} out=${evalTokens}`);
      return {
        ok: true,
        attempts: attempt + 1,
        insight: result.parsed,
        validation: result,
        totalMs,
        promptTokens,
        evalTokens,
        endpoint,
        errors,
      };
    }

    const summary = !result.schemaValid
      ? `schema-invalid (${result.schemaErrors.length} errs)`
      : `grounding-invalid (${result.groundingErrors.length} errs)`;
    errors.push(`attempt ${attempt + 1}: ${summary}`);
    log.warn(`v3:${tag}`, `attempt ${attempt + 1}/${maxAttempts} ${summary} — ${result.schemaErrors[0] ?? result.groundingErrors[0] ?? "?"}`);
  }

  return {
    ok: false,
    attempts: maxAttempts,
    insight: lastResult?.parsed ?? null,
    validation: lastResult ?? {
      ok: false,
      schemaValid: false,
      schemaErrors: ["no successful call"],
      schemaWarnings: [],
      groundingErrors: [],
      parsed: null,
      parseError: null,
      raw: "",
    },
    totalMs,
    promptTokens,
    evalTokens,
    endpoint,
    errors,
  };
}

// ── Field manifests (appended to system prompt) ──────────────────────────────

export const SLEEP_MANIFEST = `FELDER-MANIFEST (exakte Namen, Reihenfolge, Typen — keine eigenen Felder erfinden, keine Felder weglassen):
1.  schema_version: const "use_case/sleep/v1"
2.  language: "de" | "en"
3.  abstain: boolean
4.  abstain_reason: string|null. Ein Satz, warum Daten nicht ausreichen. Null wenn abstain=false.
5.  headline: string|null. Verb-led, eine Zeile, erscheint als Karten-Titel im Dashboard. Null wenn abstain=true.
6.  summary_short: string|null. Knappe Headline-Zeile auf einer Telefon-Karte, eine Aussage, ≥1 konkrete Zahl.
7.  summary_long: string|null. 1-3 Sätze für den Card-Body, ≥1 Baseline-/Delta-Bezug.
8.  analysis_today: string|null. Fließtext für den "Heute"-Block der Domain-Seite, so kompakt wie der Befund zulässt, ≥2 konkrete Zahlen.
9.  analysis_context: string|null. Einordnung gegen Baselines und letzte 2 Nächte, ≥1 z-Score ODER Delta UND ≥1 Vergleich.
10. suggestions_today: Array (0-3) von { reasoning (Begründung, warum genau diese Aktion jetzt — zitiere das Signal), anchor (das auslösende Signal als kurzer Chip), tiny (die Aktion als imperativen Chip), why (1-2 Sätze Mechanismus), horizon ("today"|"tonight") }
11. suggestions_long_term: Array (0-3) von { reasoning, horizon ("this_week"|"this_month"), action (kurze Aktion), why (Mechanismus) }
12. kpis: Array (3-5) von { reasoning, id (snake_case), label_de (kurze Chip-Beschriftung), value (0-100), band ("above_usual"|"steady"|"below_usual") }. Erste 3 in dieser Reihenfolge: sleep_quality, recovery_readiness, sleep_consistency.
13. confidence: { reasoning, value (0-1) }`;

export const RECOVERY_MANIFEST = `FELDER-MANIFEST (exakte Namen, Reihenfolge, Typen — keine eigenen Felder erfinden, keine Felder weglassen):
1.  schema_version: const "use_case/recovery/v1"
2.  language: "de" | "en"
3.  abstain: boolean
4.  abstain_reason: string|null. Ein Satz, warum Daten nicht ausreichen. Null wenn abstain=false.
5.  headline: string|null. Verb-led, eine Zeile, Karten-Titel.
6.  summary_short: string|null. Knappe Headline-Zeile auf einer Telefon-Karte, ≥1 konkrete Zahl.
7.  summary_long: string|null. 1-3 Sätze Card-Body, ≥1 Baseline-/Delta-Bezug.
8.  analysis_today: string|null. Fließtext für den "Heute"-Block, ≥2 Zahlen (HRV, RHR-Drift, Stress, SpO₂).
9.  analysis_context: string|null. Einordnung gegen Baselines + letzte 2 Tage, ≥1 z-Score UND ≥1 Vergleich.
10. suggestions_today: Array (0-3) von { reasoning, anchor, tiny, why, horizon ("today"|"tonight") }
11. suggestions_long_term: Array (0-3) von { reasoning, horizon ("this_week"|"this_month"), action, why }
12. kpis: Array (3-5) von { reasoning, id (snake_case), label_de, value (0-100), band }. Erste 3: recovery_score, autonomic_balance, stress_load.
13. confidence: { reasoning, value (0-1) }`;

export const ACTIVITY_MANIFEST = `FELDER-MANIFEST (exakte Namen, Reihenfolge, Typen — keine eigenen Felder erfinden, keine Felder weglassen):
1.  schema_version: const "use_case/activity/v1"
2.  language: "de" | "en"
3.  abstain: boolean
4.  abstain_reason: string|null. Ein Satz, warum Daten nicht ausreichen.
5.  headline: string|null. Verb-led, eine Zeile, Karten-Titel.
6.  summary_short: string|null. Knappe Headline-Zeile, ≥1 konkrete Zahl (Schritte, Workout, active_min).
7.  summary_long: string|null. 1-3 Sätze Card-Body, ≥1 Baseline-/Delta-Bezug.
8.  analysis_today: string|null. Fließtext für den "Heute"-Block, ≥2 Zahlen (Workouts, Steps, active_min, sedentary).
9.  analysis_context: string|null. Einordnung gegen Baselines + letzte 2 Tage, ≥1 z-Score UND ≥1 Vergleich.
10. suggestions_today: Array (0-3) von { reasoning, anchor, tiny, why, horizon ("today"|"tonight") }
11. suggestions_long_term: Array (0-3) von { reasoning, horizon ("this_week"|"this_month"), action, why }
12. kpis: Array (3-5) von { reasoning, id (snake_case), label_de, value (0-100), band }. Erste 3: training_quality, volume_load, recovery_demand.
13. confidence: { reasoning, value (0-1) }`;

export const SYNTHESIS_MANIFEST = `FELDER-MANIFEST (exakte Namen, Reihenfolge, Typen — keine eigenen Felder erfinden, keine Felder weglassen):
1.  schema_version: const "use_case/synthesis/v1"
2.  language: "de" | "en"
3.  abstain: boolean
4.  abstain_reason: string|null.
5.  verdict_band: "above_usual"|"steady"|"below_usual"|null. Default = verdict_band_deterministic. Abweichung nur mit explizitem Grund.
6.  headline: string|null. Verb-led, eine Zeile, Tagesbezug, ≥1 Zahl. Erscheint als Hero-Titel.
7.  summary_short: string|null. Knappe Headline-Zeile auf Phone-Hero, ≥1 konkrete Zahl.
8.  summary_long: string|null. 2-4 Sätze Hero-Body, ≥2 Domain-KPIs zitiert.
9.  key_insight: string|null. EIN Cross-Domain-Insight als 2-4 Sätze, ≥2 Werte aus verschiedenen Domains.
10. top_action_today: Object|null { reasoning, source_domain ("sleep"|"recovery"|"activity"|"cross_domain"), anchor, tiny, why, horizon ("today"|"tonight") }
11. domain_pointers: Array (genau 3, je 1 pro Domain in Reihenfolge sleep, recovery, activity) von { reasoning, domain ("sleep"|"recovery"|"activity"), label_de, kpi_id (snake_case), kpi_value (0-100), kpi_band, callout }
12. contradictions: Array (0-3) von { reasoning, domains (Array von Domain-Strings, 2-3 items), conflict, resolution }. Leer falls keine.
13. confidence: { reasoning, value (0-1) }`;
