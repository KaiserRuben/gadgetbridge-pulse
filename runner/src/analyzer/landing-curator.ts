/**
 * Landing curator — Phase 3 LLM stage.
 *
 * Pure function. Takes the deterministic candidate menu produced by
 * `lib/landing-candidates.ts` (math computes), asks qwen3.6 ONE narrow
 * question (LLM frames): pick a headline + 4 per-domain section
 * annotations + optional also_see pointers. Output is the LandingLayout
 * the dashboard renders.
 *
 * Locked architectural rules:
 *   - LLM never invents numbers. Every annotation cites a candidate's
 *     evidence_de string verbatim or "wenig Daten".
 *   - LLM never re-orders surprise. The candidate list arrives sorted
 *     by |z| and the LLM must pick from the top, not search through.
 *   - Time-of-day bias is applied via the system prompt, not by
 *     re-sorting candidates (math owns ranking).
 *   - Schema-enforced via Ollama `format`.
 *   - Deterministic seed fnv1a(date) so re-runs for the same day produce
 *     the same layout (cache idempotent).
 */

import type {
  LandingCandidate,
  LandingDomain,
} from "./landing-candidates-core.ts";
import { callOllama } from "../ollama.ts";

export type DaypartHint = "morning" | "afternoon" | "evening" | "unknown";

export interface LandingLayout {
  schema_version: "landing/v1";
  /** YYYY-MM-DD anchor. */
  date: string;
  /** ISO timestamp the layout was generated. */
  generated_at: string;
  headline: {
    candidate_key: string;
    /** ≤60 chars, German. */
    title_de: string;
    /** ≤140 chars, German, must cite a number from the candidate. */
    body_de: string;
    chart_hint: { domain: LandingDomain; metric: string };
    /** e.g. "/sleep/today" or "/heart". */
    link_to: string;
  };
  sections: Record<
    LandingDomain,
    {
      primary_candidate_key: string | null;
      /** ≤100 chars; "wenig Daten" if no candidate. */
      annotation_de: string;
      link_to: string;
    }
  >;
  also_see?: Array<{ label_de: string; href: string }>;
}

export interface CurateLandingOptions {
  model?: string;
  ollamaUrl?: string;
  /**
   * TODO: no longer wired. `callOllama` uses a long-run dispatcher with
   * timeouts disabled. Kept for source compatibility.
   */
  timeoutMs?: number;
}

export interface ContextHint {
  /** YYYY-MM-DD anchor. */
  dateKey: string;
  /** 0..23 — caller's best guess at local hour. */
  localHourGuess?: number;
}

const DOMAINS: readonly LandingDomain[] = [
  "sleep",
  "heart",
  "body",
  "activity",
];

const SYSTEM_PROMPT = `Du wählst aus einer Liste deterministisch berechneter Kandidaten den prägnantesten Insight für heute. Gib NUR Strings, die Werte aus den Kandidaten zitieren. KEINE Diagnosen, KEINE Risiko-Aussagen, KEINE Substanz-Empfehlungen, KEINE imperative ("du musst").

Antworte NUR mit gültigem JSON. Format genau so:
{
 "headline":{"candidate_key":"...","title_de":"...","body_de":"...","chart_hint":{"domain":"sleep|heart|body|activity","metric":"..."},"link_to":"/..."},
 "sections":{
  "sleep":{"primary_candidate_key":"...|null","annotation_de":"...","link_to":"/sleep|/sleep/today"},
  "heart":{"primary_candidate_key":"...|null","annotation_de":"...","link_to":"/heart|/heart/today"},
  "body":{"primary_candidate_key":"...|null","annotation_de":"...","link_to":"/body|/body/today"},
  "activity":{"primary_candidate_key":"...|null","annotation_de":"...","link_to":"/activity|/activity/today"}
 },
 "also_see":[{"label_de":"...","href":"/..."}]
}

Regeln:
- title_de ≤60 Zeichen, body_de ≤140, annotation_de ≤100.
- 1 headline mit höchster relevant_value-Kombination (surprise_label + Tageszeit-Bias).
- Genau 4 sections (sleep, heart, body, activity).
- annotation_de zitiert eine Zahl aus dem Kandidaten oder schreibt "wenig Daten".
- link_to: "/[domain]/today" wenn der Kandidat ein "today"-Frame ist, sonst "/[domain]".
- also_see: 0 bis 3 Einträge zu interessanten Drill-downs (leer-Array erlaubt).
- Tageszeit-Bias: morning → sleep bevorzugen. afternoon → activity/heart. evening → body/recovery.
- Wenn Kandidat fragile=true ist, niemals als Headline wählen, außer keine andere Option.`;

const SECTION_OBJ = {
  type: "object",
  additionalProperties: false,
  properties: {
    primary_candidate_key: { type: ["string", "null"], maxLength: 80 },
    annotation_de: { type: "string", maxLength: 100 },
    link_to: { type: "string", maxLength: 40 },
  },
  required: ["primary_candidate_key", "annotation_de", "link_to"],
} as const;

/**
 * Tight maxLength on EVERY string field is critical. Without bounds, format
 * mode lets qwen3.6 enter generation loops where the same JSON branch keeps
 * expanding (~observed in 4-min hangs even on a 1.2 KB prompt). Coaching-
 * trajectory.ts confirms the pattern: every property has a length cap.
 */
const LANDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidate_key: { type: "string", maxLength: 80 },
        title_de: { type: "string", maxLength: 60 },
        body_de: { type: "string", maxLength: 140 },
        chart_hint: {
          type: "object",
          additionalProperties: false,
          properties: {
            domain: {
              type: "string",
              enum: ["sleep", "heart", "body", "activity"],
            },
            metric: { type: "string", maxLength: 40 },
          },
          required: ["domain", "metric"],
        },
        link_to: { type: "string", maxLength: 40 },
      },
      required: [
        "candidate_key",
        "title_de",
        "body_de",
        "chart_hint",
        "link_to",
      ],
    },
    sections: {
      type: "object",
      additionalProperties: false,
      properties: {
        sleep: SECTION_OBJ,
        heart: SECTION_OBJ,
        body: SECTION_OBJ,
        activity: SECTION_OBJ,
      },
      required: ["sleep", "heart", "body", "activity"],
    },
    also_see: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label_de: { type: "string", maxLength: 60 },
          href: { type: "string", maxLength: 60 },
        },
        required: ["label_de", "href"],
      },
    },
  },
  required: ["headline", "sections"],
} as const;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function daypartFromHour(hour: number | undefined): DaypartHint {
  if (hour === undefined || !Number.isFinite(hour)) return "unknown";
  if (hour <= 11) return "morning";
  if (hour <= 17) return "afternoon";
  return "evening";
}

function round(v: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

/**
 * Compact, JSON-safe candidate row for the LLM. Keeps prompt tight and
 * surfaces only the fields the curator should reason about.
 */
function compactCandidate(c: LandingCandidate): Record<string, unknown> {
  return {
    key: c.key,
    domain: c.domain,
    metric_label_de: c.metric_label_de,
    timeframe: c.timeframe,
    value: c.value === null ? null : round(c.value, 2),
    unit: c.unit,
    z_score: c.z_score === null ? null : round(c.z_score, 2),
    surprise_label: c.surprise_label,
    trend_direction: c.trend_direction,
    fragile: c.fragile,
    n_days: c.n_days,
    evidence_de: c.evidence_de,
  };
}

function buildUserMessage(
  candidates: LandingCandidate[],
  hint: ContextHint,
): string {
  const daypart = daypartFromHour(hint.localHourGuess);
  const compact = candidates.map(compactCandidate);
  return [
    `DATUM: ${hint.dateKey}`,
    `TAGESZEIT: ${daypart}`,
    "",
    "KANDIDATEN (sortiert nach |z|, höchste zuerst):",
    JSON.stringify(compact),
    "",
    "Wähle Headline + 4 Sektionen.",
  ].join("\n");
}

/**
 * Validate + tighten the LLM output. Throws on schema violations the
 * Ollama format mode might still produce a malformed JSON for.
 *
 * Note: we DO NOT reshape candidate_key references — if the LLM picked
 * a non-existent key we substitute the top-ranked candidate for that
 * domain so the dashboard never renders a dangling link.
 */
function parseLayout(
  raw: string,
  candidates: LandingCandidate[],
  date: string,
): LandingLayout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `landing-curator: invalid JSON content from LLM: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("landing-curator: top-level must be an object");
  }
  const obj = parsed as Record<string, unknown>;

  // ── headline ────────────────────────────────────────────────────────
  if (typeof obj.headline !== "object" || obj.headline === null) {
    throw new Error("landing-curator: missing headline object");
  }
  const h = obj.headline as Record<string, unknown>;
  const headlineKey =
    typeof h.candidate_key === "string" ? h.candidate_key : "";
  if (!headlineKey) {
    throw new Error("landing-curator: headline.candidate_key missing");
  }
  if (typeof h.title_de !== "string" || typeof h.body_de !== "string") {
    throw new Error("landing-curator: headline title/body missing");
  }
  const chartHint = h.chart_hint as Record<string, unknown> | undefined;
  if (
    !chartHint ||
    typeof chartHint.domain !== "string" ||
    typeof chartHint.metric !== "string"
  ) {
    throw new Error("landing-curator: headline.chart_hint malformed");
  }
  const linkTo = typeof h.link_to === "string" ? h.link_to : "";
  if (!linkTo) {
    throw new Error("landing-curator: headline.link_to missing");
  }

  // Substitute headline if LLM picked an unknown key.
  const knownKeys = new Set(candidates.map((c) => c.key));
  const finalHeadlineKey = knownKeys.has(headlineKey)
    ? headlineKey
    : candidates[0]?.key ?? headlineKey;

  // ── sections ────────────────────────────────────────────────────────
  if (typeof obj.sections !== "object" || obj.sections === null) {
    throw new Error("landing-curator: missing sections object");
  }
  const secs = obj.sections as Record<string, unknown>;
  const sections = {} as LandingLayout["sections"];
  for (const dom of DOMAINS) {
    const raw = secs[dom];
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`landing-curator: section.${dom} missing`);
    }
    const r = raw as Record<string, unknown>;
    const candKey =
      r.primary_candidate_key === null
        ? null
        : typeof r.primary_candidate_key === "string"
          ? r.primary_candidate_key
          : null;
    if (typeof r.annotation_de !== "string") {
      throw new Error(`landing-curator: section.${dom}.annotation_de missing`);
    }
    if (typeof r.link_to !== "string") {
      throw new Error(`landing-curator: section.${dom}.link_to missing`);
    }
    // If the LLM picked an unknown key, swap to the highest-|z| candidate
    // for this domain (or null if none exist).
    let resolvedKey: string | null = candKey;
    if (resolvedKey !== null && !knownKeys.has(resolvedKey)) {
      const fallback = candidates.find((c) => c.domain === dom);
      resolvedKey = fallback ? fallback.key : null;
    }
    sections[dom] = {
      primary_candidate_key: resolvedKey,
      annotation_de: r.annotation_de.slice(0, 100),
      link_to: r.link_to,
    };
  }

  // ── also_see ───────────────────────────────────────────────────────
  let also: LandingLayout["also_see"];
  if (Array.isArray(obj.also_see)) {
    const items: NonNullable<LandingLayout["also_see"]> = [];
    for (const it of obj.also_see) {
      if (typeof it !== "object" || it === null) continue;
      const r = it as Record<string, unknown>;
      if (typeof r.label_de !== "string" || typeof r.href !== "string") {
        continue;
      }
      items.push({ label_de: r.label_de.slice(0, 60), href: r.href });
      if (items.length >= 3) break;
    }
    if (items.length > 0) also = items;
  }

  const layout: LandingLayout = {
    schema_version: "landing/v1",
    date,
    generated_at: new Date().toISOString(),
    headline: {
      candidate_key: finalHeadlineKey,
      title_de: h.title_de.slice(0, 60),
      body_de: h.body_de.slice(0, 140),
      chart_hint: {
        domain: chartHint.domain as LandingDomain,
        metric: chartHint.metric,
      },
      link_to: linkTo,
    },
    sections,
  };
  if (also) layout.also_see = also;
  return layout;
}

/**
 * One sequential Ollama call. Caller serialises against other Ollama
 * traffic (single-GPU). Hard 180s timeout default — generous for cold-
 * start model loads (36B MoE Q4 takes ~30 s to map into VRAM); the route
 * handler caps user-facing latency tighter.
 */
export async function curateLanding(
  candidates: LandingCandidate[],
  contextHint: ContextHint,
  opts: CurateLandingOptions = {},
): Promise<LandingLayout> {
  if (candidates.length === 0) {
    throw new Error("landing-curator: no candidates supplied");
  }
  const model = opts.model ?? "qwen3.6:latest";
  const seed = fnv1a(contextHint.dateKey);

  // We use "json" string format (free JSON) rather than `format: SCHEMA`
  // because qwen3.6 stalls on multi-level nested-object schemas with
  // enums (observed: 4-min generation hangs even on a 1.2 KB prompt).
  // The system prompt ships the exact JSON template inline, and we
  // post-validate in `parseLayout` — same end-state, dramatically faster.
  const result = await callOllama({
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(candidates, contextHint),
    format: "json",
    options: {
      temperature: 0.2,
      num_ctx: 4096,
      num_predict: 800,
      seed,
    },
    baseUrl: opts.ollamaUrl,
    tag: "landing_curator",
  });
  // Keep the explicit schema for reference / future re-enable when the
  // upstream model is faster on multi-level enums.
  void LANDING_SCHEMA;

  const content = result.content;
  if (!content) {
    throw new Error("landing-curator: empty content");
  }
  return parseLayout(content, candidates, contextHint.dateKey);
}
