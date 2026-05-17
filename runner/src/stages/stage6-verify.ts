/**
 * Stage 6 — Verifier.
 *
 * Five layers run in order; any layer can fail. Layer 1 (AJV) and
 * Layer 2 (confidence math) are CRITICAL — failure forces an upstream
 * retry or pipeline_status="partial". Layers 3 (numbers-in-facts),
 * 4 (claim-id linkage) and 5 (forbidden patterns) are warn-only on the
 * first attempt — the orchestrator may retry once and abstain on second
 * failure (P5+ wires that path).
 *
 * Layer order (DO NOT REORDER):
 *   1. AJV schema validation (daily.schema.json)
 *   2. Confidence math: |value - Σ(w·s)| < 0.05
 *   3. Numbers-in-facts: every "<n> <unit>" in prose must appear in factsString
 *   4. claim_id ↔ evidence_id linkage
 *   5. Forbidden patterns (F1–F12 + autonomy) — German prose checks
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";

import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import type { Observation } from "@/lib/types/observations";
import { dailySchema } from "../schemas/v2/index.ts";
import { checkPairedGrounding } from "./stage6-paired-grounding.ts";
import { computeConfidenceHint } from "../prompts/daily.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateDaily = ajv.compile(dailySchema);

export interface VerifyLayer {
  name: string;
  ok: boolean;
  details?: string;
  /** Was this layer treated as a hard failure? (ajv + confidence_math) */
  critical: boolean;
}

export interface VerifyResult {
  ok: boolean;
  layers: VerifyLayer[];
}

const CONFIDENCE_TOLERANCE = 0.05;

/** Causal connectives that — when paired with two metric/value mentions —
 *  trigger F3 (forbidden cross-metric causal claim). */
const F3_CAUSAL_CONNECTIVES =
  /\b(verursacht|führt zu|löst aus|wegen|aufgrund|deshalb|daher|deswegen)\b/i;
/** A simple "<n> <unit>" detector used only for F3 pair-counting. */
const F3_METRIC_VALUE = /\d+(?:[.,]\d+)?\s*(?:bpm|ms|%|min|h|°C|kcal|km)/gi;

const NUMBER_UNIT_REGEX =
  /(\d+(?:[.,]\d+)?)\s*(bpm|ms|%|°C|min|h|kcal|km|Schritte)/g;

// F12: bare "dein <Score> ist N". Allowed when softened by ", der " relative
// clause OR a deutendes Verb ("wirkt", "deutet"). Implemented in the helper
// below rather than as a flat regex so the "allowed if" rules can apply.
const F12_BARE_SCORE =
  /\bdein\s+(Recovery|HRV-Score|Stress-Score|Schlaf-Score)\s+ist\s+\d+/i;
const F12_SOFTENERS = /(,\s*der\s|wirkt|deutet)/i;

/**
 * Forbidden-pattern table. Each entry has:
 *   id   — F1..F12 / Autonomy
 *   re   — pattern (or null for the structural F5/F12 rules handled
 *          separately below)
 *   desc — short English description
 */
const FORBIDDEN_PATTERNS: Array<{
  id: string;
  re: RegExp | null;
  desc: string;
}> = [
  {
    id: "F1_DIAGNOSIS",
    re: /\b(Schlafapnoe|Apnoe|AFib|Vorhofflimmern|Herzrhythmusstörung|Diabetes|Bluthochdruck|Depression|Burnout|Arrhythmie|Bradykardie|Tachykardie)\b/i,
    desc: "diagnosis term",
  },
  {
    id: "F2_SUBSTANCE",
    re: /\b(Ibuprofen|Melatonin|Magnesium|Vitamin D|Nahrungsergänzung|Supplement|Schlafmittel|Medikament)\b/i,
    desc: "substance / medication recommendation",
  },
  // F3 is handled by a structural detector (causal connective + 2+ metric values).
  { id: "F3_CAUSAL", re: null, desc: "cross-metric causal claim" },
  {
    id: "F4_RISK",
    re: /erhöhtes Risiko für|könnte auf .{0,30} hindeuten|Vorstufe|Risikofaktor/i,
    desc: "risk speculation",
  },
  // F5 is a structural rule (down driver + null action + abstain=false + no 'nur zur Info').
  { id: "F5_DOWN_NOACTION", re: null, desc: "down driver without action or abstain" },
  {
    id: "F6_DIAGNOSTIC_DU",
    re: /\bdu\s+bist\s+(müde|schlecht|schwach|kaputt|erschöpft)\b/i,
    desc: "diagnostic 'du bist …'",
  },
  {
    id: "F7_PSEUDO_EMPATHY",
    re: /(ich mache mir Sorgen|ich bin (stolz|besorgt)|großartig!|super!|toll gemacht)/i,
    desc: "pseudo-empathy / cheerleading",
  },
  {
    id: "F8_FAKE_MEMORY",
    re: /letzte Woche hast du (gesagt|erwähnt)|du hast (gestern|neulich) (gesagt|erwähnt)/i,
    desc: "invented memory",
  },
  {
    id: "F9_URGENCY",
    re: /\b(DRINGEND|SOFORT|URGENT|kritisch!|KRITISCH)\b/,
    desc: "urgency",
  },
  {
    id: "F10_STREAK",
    re: /wenn du heute (auslässt|nicht machst)|dein Streak|Streak verlierst/i,
    desc: "streak manipulation",
  },
  {
    id: "F11_COMPARE_OTHERS",
    re: /andere (Nutzer|Menschen|Personen) (schlafen|bewegen|haben)|du liegst unter dem Durchschnitt/i,
    desc: "compare-with-others",
  },
  // F12 handled below (bare score allowed if softener is present).
  { id: "F12_BARE_SCORE", re: null, desc: "bare score without framing" },
  {
    id: "AUTONOMY",
    re: /\bdu\s+(musst|solltest|sollst)\b/i,
    desc: "imperative — violates SDT autonomy",
  },
  // S1_RELATIVIZED handled below (only fires when observations contains tier=S1).
  {
    id: "S1_RELATIVIZED",
    re: null,
    desc: "S1 observation relativized by data-quality softening in summary",
  },
];

/**
 * Detect F3 — a sentence containing a causal connective AND ≥2 metric/value
 * mentions counts as a forbidden cross-metric causal claim.
 */
function f3Detect(prose: string): boolean {
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n/)) {
    if (!F3_CAUSAL_CONNECTIVES.test(sentence)) continue;
    const matches = sentence.match(F3_METRIC_VALUE) ?? [];
    if (matches.length >= 2) return true;
  }
  return false;
}

/** F5 — structural: a down driver + null action + abstain=false + summary
 *  doesn't say 'nur zur Info'. */
function f5Detect(daily: DailyInsightV2): boolean {
  const downDriver = daily.drivers.some((d) => d.direction === "down");
  if (!downDriver) return false;
  if (daily.abstain) return false;
  if (daily.action) return false;
  const summary = daily.summary ?? "";
  if (/nur zur info/i.test(summary)) return false;
  return true;
}

/** F12 — `dein <Score> ist N` allowed only with `, der `, "wirkt", or
 *  "deutet" softener inside the same sentence. */
function f12Detect(prose: string): boolean {
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n/)) {
    if (!F12_BARE_SCORE.test(sentence)) continue;
    if (F12_SOFTENERS.test(sentence)) continue;
    return true;
  }
  return false;
}

/**
 * S1_RELATIVIZED — fires when at least one tier=S1 observation exists AND the
 * prose summary contains a phrase that softens or casts doubt on the finding.
 * Protects safety signals from being undermined by data-quality framing.
 */
const S1_SOFTENERS =
  /(?:nur zur Info|Datenlücke|unsicher|daher unklar|daher unsicher|könnte ungenau|Datenbasis.{0,20}schwach)/i;

function s1RelativizedDetect(daily: DailyInsightV2, observations: Observation[]): boolean {
  const hasS1 = observations.some((o) => o.tier === "S1");
  if (!hasS1) return false;
  const summary = daily.summary ?? "";
  return S1_SOFTENERS.test(summary);
}

/**
 * Layer 3 — every "<n> <unit>" in prose must appear (rounded best-effort)
 * inside the stringified facts JSON.
 */
function checkNumbersInFacts(
  prose: string,
  factsString: string,
): { matchCount: number; missing: string[] } {
  const factsLower = factsString.toLowerCase();
  const missing: string[] = [];
  let matchCount = 0;
  let m: RegExpExecArray | null;
  NUMBER_UNIT_REGEX.lastIndex = 0;
  while ((m = NUMBER_UNIT_REGEX.exec(prose)) !== null) {
    matchCount++;
    const valueStr = m[1].replace(",", ".");
    const num = Number(valueStr);
    if (!Number.isFinite(num)) continue;
    const candidates = [
      String(Math.round(num)),
      String(Math.round(num * 10) / 10),
      String(Math.round(num * 100) / 100),
    ];
    const found = candidates.some((c) => factsLower.includes(c.toLowerCase()));
    if (!found) missing.push(m[0]);
  }
  NUMBER_UNIT_REGEX.lastIndex = 0;
  return { matchCount, missing };
}

export function verify(
  daily: DailyInsightV2,
  _facts: FactsBundleV2,
  factsString: string,
  observations: Observation[] = [],
): VerifyResult {
  const layers: VerifyLayer[] = [];

  // Layer 1: AJV schema
  const ok1 = validateDaily(daily);
  layers.push({
    name: "ajv",
    ok: !!ok1,
    critical: true,
    details: ok1
      ? undefined
      : (validateDaily.errors ?? [])
          .slice(0, 5)
          .map((e) => `${e.instancePath || "/"} ${e.message}`)
          .join("; "),
  });

  // Layer 2: confidence math
  const calcNum = parseConfidenceCalc(
    daily.confidence?.calc,
    daily.confidence?.factors,
  );
  const value = daily.confidence?.value ?? NaN;
  const mathOk =
    calcNum !== null && Math.abs(value - calcNum) < CONFIDENCE_TOLERANCE;
  layers.push({
    name: "confidence_math",
    ok: mathOk,
    critical: true,
    details: mathOk
      ? undefined
      : `value=${value} calc=${calcNum} delta=${calcNum !== null ? Math.abs(value - calcNum).toFixed(3) : "n/a"}`,
  });

  // Layer 3: numbers-in-facts
  const proseFields: (string | null)[] = [
    daily.headline,
    daily.summary,
    daily.affirmation,
    daily.reflection,
    daily.action?.tiny ?? null,
    daily.action?.anchor ?? null,
    daily.action?.fallback ?? null,
    daily.abstain_reason,
    ...daily.drivers.map((d) => d.clause),
    ...daily.drivers.map((d) => d.delta_text),
  ];
  const proseString = proseFields
    .filter((s): s is string => typeof s === "string")
    .join("\n");
  const numbers = checkNumbersInFacts(proseString, factsString);
  const numbersOk = numbers.missing.length === 0;
  layers.push({
    name: "numbers_in_facts",
    ok: numbersOk,
    critical: false, // warn-on-first-attempt; orchestrator may retry then abstain
    details:
      numbers.matchCount === 0
        ? "no numbers in prose (vacuous)"
        : numbersOk
          ? undefined
          : `missing in facts: ${numbers.missing.join(", ")}`,
  });

  // Layer 4: claim_id ↔ evidence_id linkage
  const obsIds = new Set(observations.map((o) => o.id));
  const dangling: string[] = [];
  for (const d of daily.drivers) {
    for (const eid of d.evidence_ids) {
      if (!obsIds.has(eid)) dangling.push(eid);
    }
  }
  const claimsOk = dangling.length === 0;
  layers.push({
    name: "claim_id_linkage",
    ok: claimsOk,
    critical: false,
    details: claimsOk
      ? daily.drivers.length === 0
        ? "no drivers (vacuous)"
        : undefined
      : `unknown evidence_ids: ${dangling.join(", ")}`,
  });

  // Layer 4b: paired numeric grounding. Tighter than the loose
  // numbers-in-facts check above — flags driver prose where the cited number
  // does not match facts.<metric_id> (today's value, baseline median, or
  // |today − baseline|). Advisory: regen-with-feedback handles this in
  // Stage 4; the post-write report here serves as a tripwire. S1-observation
  // metrics are exempted from the direction check — see helper.
  const paired = checkPairedGrounding(daily, _facts, observations);
  layers.push({
    name: "paired_grounding",
    ok: paired.ok,
    critical: false,
    details: paired.ok ? undefined : paired.violations.join(" | "),
  });

  // Layer 4c: confidence calibration. computed_max is derived from the same
  // hint the prompt feeds in. Allow +0.10 slack: the LLM may justifiably round
  // a factor up by one tier given context the deterministic computation
  // doesn't see. Beyond that, the value is over-claimed.
  const hint = computeConfidenceHint(_facts, observations);
  const reportedValue = typeof daily.confidence?.value === "number" ? daily.confidence.value : NaN;
  const calibratedOk = !Number.isFinite(reportedValue) || reportedValue <= hint.computed_max + 0.10;
  layers.push({
    name: "confidence_calibration",
    ok: calibratedOk,
    critical: false,
    details: calibratedOk
      ? undefined
      : `value=${reportedValue.toFixed(3)} > computed_max=${hint.computed_max} + 0.10`,
  });

  // Layer 5: forbidden patterns
  const forbiddenHits: string[] = [];
  for (const entry of FORBIDDEN_PATTERNS) {
    if (entry.id === "F3_CAUSAL") {
      if (f3Detect(proseString)) forbiddenHits.push(entry.id);
      continue;
    }
    if (entry.id === "F5_DOWN_NOACTION") {
      if (f5Detect(daily)) forbiddenHits.push(entry.id);
      continue;
    }
    if (entry.id === "F12_BARE_SCORE") {
      if (f12Detect(proseString)) forbiddenHits.push(entry.id);
      continue;
    }
    if (entry.id === "S1_RELATIVIZED") {
      if (s1RelativizedDetect(daily, observations)) forbiddenHits.push(entry.id);
      continue;
    }
    if (entry.re && entry.re.test(proseString)) forbiddenHits.push(entry.id);
  }
  const forbiddenOk = forbiddenHits.length === 0;
  // S1_RELATIVIZED is safety-critical — undermining a tier=S1 finding can hide
  // a real risk signal. All other forbidden patterns stay non-critical (warn).
  const s1Hit = forbiddenHits.includes("S1_RELATIVIZED");
  layers.push({
    name: "forbidden_patterns",
    ok: forbiddenOk,
    critical: s1Hit,
    details: forbiddenOk
      ? proseString.length === 0
        ? "no prose (vacuous)"
        : undefined
      : `matched: ${forbiddenHits.join(", ")}`,
  });

  const ok = layers.every((l) => l.ok || !l.critical);
  return { ok, layers };
}

/**
 * Parse the confidence.calc string into a numeric Σ(w·s).
 *
 * Accepts (in order):
 *   1. A bare number string ("0.62").
 *   2. An expression with a trailing "= <number>" tail.
 *   3. The first product-sum it can parse (e.g. "0.4*0.8 + 0.3*0.6").
 *   4. Falls back to Σ(w·s) parsed from `factors[]` strings of the form
 *      "<name>: w=<num> s=<num>".
 *
 * Returns null when no numeric value can be derived.
 */
function parseConfidenceCalc(
  calc: unknown,
  factors: unknown,
): number | null {
  if (typeof calc === "string") {
    const trimmed = calc.trim();
    // (1) bare number
    const direct = Number(trimmed);
    if (Number.isFinite(direct)) return direct;
    // (2) "...= <number>"
    const tail = trimmed.match(/=\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (tail) {
      const t = Number(tail[1]);
      if (Number.isFinite(t)) return t;
    }
    // (3) sum of product terms a*b separated by + or -
    const terms = trimmed
      .replace(/=\s*-?\d+(?:\.\d+)?\s*$/, "")
      .split(/\s*\+\s*/);
    let sum = 0;
    let ok = false;
    for (const term of terms) {
      const m = term.trim().match(/^(-?\d+(?:\.\d+)?)\s*\*\s*(-?\d+(?:\.\d+)?)$/);
      if (m) {
        sum += Number(m[1]) * Number(m[2]);
        ok = true;
        continue;
      }
      const single = Number(term.trim());
      if (Number.isFinite(single)) {
        sum += single;
        ok = true;
        continue;
      }
      ok = false;
      break;
    }
    if (ok) return sum;
  }
  // (4) Σ(w·s) from factors list
  if (Array.isArray(factors)) {
    let sum = 0;
    let parsedAny = false;
    for (const f of factors) {
      if (typeof f !== "string") continue;
      const w = f.match(/w\s*=\s*(-?\d+(?:\.\d+)?)/);
      const s = f.match(/s\s*=\s*(-?\d+(?:\.\d+)?)/);
      if (w && s) {
        sum += Number(w[1]) * Number(s[1]);
        parsedAny = true;
      }
    }
    if (parsedAny) return sum;
  }
  return null;
}

/**
 * Whether any critical layer failed. Caller can use this to decide
 * whether to retry the LLM stages (P5+) or write status=partial.
 */
export function criticalFailed(result: VerifyResult): boolean {
  return result.layers.some((l) => l.critical && !l.ok);
}

/**
 * Whether any non-critical layer (numbers-in-facts, claim-id linkage,
 * forbidden patterns) failed. P5 will use this signal to drive the
 * second-attempt retry / abstain path.
 */
export function softFailed(result: VerifyResult): boolean {
  return result.layers.some((l) => !l.critical && !l.ok);
}

/**
 * Pre-stage-5 semantic check used by the orchestrator's regen-with-feedback
 * loop. Returns a structured violation list the next Stage 4 attempt can act
 * on directly.
 *
 * Scope: only the rules where regen actually helps —
 *   - paired numeric grounding (driver claims a value that doesn't match facts)
 *   - S1 relativisation
 *   - non-vacuous forbidden patterns the LLM can rewrite around (F1, F2, F4,
 *     F6, F7, F8, F9, F10, F11, AUTONOMY)
 *
 * Schema validity, confidence math, and dangling evidence ids are handled by
 * Stage 4's own retry loop and the post-write verifier.
 */
export interface SemanticCheckResult {
  ok: boolean;
  violations: string[];
  s1Triggered: boolean;
}

const REGENABLE_FORBIDDEN: Record<string, string> = {
  F1_DIAGNOSIS: "Prosa enthält Diagnosebegriffe — entferne klinische Termini.",
  F2_SUBSTANCE: "Prosa empfiehlt Wirkstoffe/Supplemente — streiche jede Substanzempfehlung.",
  F4_RISK: "Prosa enthält Risiko-Spekulation — entferne 'Risikofaktor'/'könnte hindeuten auf'.",
  F6_DIAGNOSTIC_DU: "Prosa enthält 'du bist <Adjektiv>' — formuliere beobachtend statt diagnostisch.",
  F7_PSEUDO_EMPATHY: "Prosa enthält Pseudoempathie/Cheerleading — sachlich bleiben.",
  F8_FAKE_MEMORY: "Prosa erfindet Erinnerungen ('letzte Woche hast du gesagt') — streichen.",
  F9_URGENCY: "Prosa enthält Dringlichkeitswörter (DRINGEND/SOFORT) — Tonfall neutral.",
  F10_STREAK: "Prosa nutzt Streak-Druck — streichen.",
  F11_COMPARE_OTHERS: "Prosa vergleicht mit anderen Nutzern — streichen.",
  AUTONOMY: "Prosa enthält Imperativ (du musst/solltest/sollst) — autonomieverletzend, umformulieren.",
  S1_RELATIVIZED:
    "Eine S1-Beobachtung wurde durch Datenqualitäts-Sprache relativiert. Nenne den S1-Befund zuerst, ohne Weichmacher wie 'nur zur Info', 'Datenlücke', 'unsicher'.",
};

export function checkSemanticViolations(
  daily: DailyInsightV2,
  facts: FactsBundleV2,
  observations: Observation[],
): SemanticCheckResult {
  const violations: string[] = [];

  // Paired numeric grounding — strongest quality lever.
  const grounding = checkPairedGrounding(daily, facts, observations);
  for (const v of grounding.violations) violations.push(v);

  // Confidence calibration — over-claimed value triggers regen.
  const hint = computeConfidenceHint(facts, observations);
  const v = typeof daily.confidence?.value === "number" ? daily.confidence.value : NaN;
  if (Number.isFinite(v) && v > hint.computed_max + 0.10) {
    violations.push(
      `confidence.value ${v.toFixed(2)} überschreitet computed_max ${hint.computed_max} um >0.10. Senke value oder reduziere die s-Scores entsprechend der Hinweis-Tabelle.`,
    );
  }

  // S1 relativisation gate.
  let s1Triggered = false;
  if (s1RelativizedDetect(daily, observations)) {
    s1Triggered = true;
    violations.push(REGENABLE_FORBIDDEN.S1_RELATIVIZED);
  }

  // Forbidden-pattern subset that's worth regen.
  const proseFields: (string | null)[] = [
    daily.headline,
    daily.summary,
    daily.affirmation,
    daily.reflection,
    daily.action?.tiny ?? null,
    daily.action?.anchor ?? null,
    daily.action?.fallback ?? null,
    ...daily.drivers.map((d) => d.clause),
    ...daily.drivers.map((d) => d.delta_text),
  ];
  const proseString = proseFields
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  for (const entry of FORBIDDEN_PATTERNS) {
    if (!REGENABLE_FORBIDDEN[entry.id]) continue;
    if (entry.id === "S1_RELATIVIZED") continue; // already handled
    if (entry.re && entry.re.test(proseString)) {
      violations.push(REGENABLE_FORBIDDEN[entry.id]);
    }
  }

  return { ok: violations.length === 0, violations, s1Triggered };
}

/**
 * Deterministic fallback summary when the model still produces an S1-relativised
 * summary after exhausting regen attempts. Restates the most-severe S1
 * observation as the primary signal without softening language.
 */
export function s1StubSummary(observations: Observation[]): string {
  const s1 = observations.find((o) => o.tier === "S1");
  if (!s1) return "Sicherheits-Signal vorhanden — Vorrang vor allem anderen.";
  const metric = s1.metric_id ?? "";
  const delta = s1.delta_text ? ` (${s1.delta_text})` : "";
  return `S1-Befund ${metric}${delta} — Vorrang vor allem anderen. Beobachte und ziehe bei Bedarf medizinischen Rat.`;
}
