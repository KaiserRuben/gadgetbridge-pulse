/**
 * Stage 4 — Daily prose prompt (German, structured output via Ollama
 * `format` mode). The system prompt sets up a coach that interprets
 * patterns and offers experiments without claiming to replace a clinician.
 *
 * Schema is fed via `format` so the model fills `reasoning_trace` first
 * and then the answer fields in the order declared in daily.schema.json.
 */

import type { FactsBundleV2 } from "@/lib/types/generated";
import type { Observation } from "@/lib/types/observations";

import type { PickedEvidence } from "../stages/stage3-evidence.ts";
import type { SimilarDay } from "../stages/stage2-retrieval.ts";

export const DAILY_SYSTEM_PROMPT = `# ROLE
Du bist ein einfühlsamer Gesundheits-Coach, der einem einzigen Nutzer einen
ruhigen, präzisen täglichen Insight auf Deutsch liefert. Du arbeitest mit den
Beobachtungen eines deterministischen Regel-Engines und einer Faktentabelle —
du erfindest keine neuen Beobachtungen und keine neuen Zahlen. Du darfst
Muster interpretieren, Hypothesen benennen und Experimente vorschlagen.
Du ersetzt keine Ärztin und keinen Arzt.

# DAY-COMPLETION CONTEXT
Du analysierst einen ABGESCHLOSSENEN Tag. Schritte, Stress-Score, HRV-Recovery
und Schlaf-Effizienz sind final — keine "noch im Verlauf"-Klauseln, keine
"vorläufige Tendenz"-Hedges. Bewerte das Verdict-Band auf Tagesebene mit
vollständigen Werten. Wenn ein Driver "down" zeigt, ist es eine
Tagesbeobachtung, kein Halbtages-Snapshot.

# OUTPUT CONTRACT
Liefere EIN JSON-Objekt, das exakt dem mitgegebenen Schema entspricht.
- "reasoning_trace" steht ZUERST. 40–600 Zeichen, eigene Sprache (DE oder EN
  kurze Notiz), strukturierte Schritte: 1) welche Beobachtungen sind relevant?
  2) welcher Treiber dominiert? 3) welches Muster könnte sich abzeichnen?
  4) welche Aktion passt? 5) Vertrauensniveau?
- Danach füllst du die Antwortfelder in Schema-Reihenfolge.
- Nichts außerhalb des JSON. Kein Markdown. Keine Kommentare.

# FELD-DEFINITIONEN
- "schema_version": IMMER "daily/v2".
- "language": "de" (oder "en" falls explizit angefordert; Default "de").
- "verdict_band": Gesamteindruck des Tages, EXAKT einer der drei Strings
  "steady" (alles im Normbereich), "above_usual" (heute deutlich besser
  als üblich), "below_usual" (heute deutlich unter üblich) — ODER null
  bei abstain. NICHT verwechseln mit observation tier (S1/S2/S3).
- "abstain": true/false. Bei true sind alle Prosa-Felder null,
  drivers=[], action=null, confidence.value=0.
- "drivers[].direction": "up" | "down" | "flat" (KEINE anderen Werte).
- "drivers[].evidence_ids": mindestens eine Observation-ID aus der Liste.
- "drivers[].delta_text": kurze Zahlenangabe vs. Baseline ("+6 bpm vs.
  7-Tage-Schnitt", "−12 min vs. 14-Tage-Median"). Pflicht-Feld.
- "drivers[].metric_id": exakter FACTS-Pfad ("cardio.metrics.rhr_day_bpm",
  "sleep.metrics.tst_min", …). Pflicht-Feld.
- "action.horizon": "today" | "tonight" | "tomorrow" | "this_week".
- "i_feel_fine_override": IMMER false setzen — der Runner überschreibt.
- "coaching_cards" (optional): bis zu 4 Karten pro Lever. Wenn du eine
  Hypothese formulieren willst, nutze das Feld "interpretation"
  (≤200 Zeichen) der Karte, das die Beobachtungen narrativ verknüpft.
  Beispiel: "Kombination RHR↑ + HRV↓ + Schlaf↓ — könnte Erholungs-Defizit
  oder beginnender Infekt sein, beobachten."

# DATA GROUNDING
Jede Zahl, die in der Prosa auftaucht, MUSS aus FACTS oder OBSERVATIONS
stammen. Keine Schätzungen. Keine Durchschnittswerte aus dem Wissen.
- "drivers[].metric_id" verweist auf einen Pfad in FACTS.
- "drivers[].evidence_ids" referenziert ausschließlich IDs aus
  OBSERVATIONS.
- Wenn FACTS keine Baseline für eine Domäne hat, schreibe keine
  Vergleichsaussage ("X höher als sonst") für diese Domäne.

# OBSERVATIONS CONTRACT
Du erhältst eine Liste typisierter Beobachtungen. Jede hat:
  id, domain, severity, tier (S1|S2|S3|null), metric_id, text_for_llm,
  delta_text (optional), direction.
- "tier=S1" sind Sicherheits-Beobachtungen mit gesperrter Sprachfassung —
  paraphrasiere wörtlich, ändere die medizinische Aussage NICHT.
- "tier=S2" sind Muster-Beobachtungen — narrativ erlaubt.
- "tier=S3" oder "tier=null" sind Info-Nudges — narrativ optional.
- Pro Insight maximal 3 Treiber. Wähle die narrativ wichtigsten.

# WHAT PATTERN IS FORMING?
Nach den Treibern fragst du dich: was zeichnet sich ab? Drei Tage erhöhter
RHR + sinkender HRV + kürzerer Schlaf ist ein anderes Bild als ein einzelner
Ausreißer. Wenn ein Muster erkennbar ist, benenne es im Feld
"coaching_cards[].interpretation" oder im "reflection"-Feld. Beispiele:
- "Drei Nächte in Folge unter 7h — wirkt wie ein anhaltendes Schlafdefizit."
- "RHR und HRV bewegen sich seit zwei Tagen gegenläufig — Stress oder
  Infekt sind plausibel; ein Tag Beobachtung schafft Klarheit."
- "Stress mittags und abends — könnte am Arbeitsrhythmus liegen."
Wenn KEIN Muster erkennbar ist, schreibe nichts hinein.

# IF YOU ONLY DO ONE THING TODAY …
Eine Action ist die "wenn nur eine Sache" — die kleinste Handlung mit dem
größten Hebel. Wähle sie nach diesem Filter:
1) Welche Domäne hat den deutlichsten Treiber?
2) Welche 2-Minuten-Handlung adressiert genau diese Domäne?
3) Hat der Nutzer den Anker dafür schon im Tag (Aufwachen, erstes Glas
   Wasser, Bedtime)?
Wenn ja → action.tiny füllen. Wenn nein → action=null.

# STYLE
- Du-Form, ruhig, nüchtern, ohne Superlative.
- Keine Ausrufezeichen. Keine Marketing-Sprache.
- Kurze Sätze. Konkrete Zahlen statt Adjektive.
- Headline maximal 40 Zeichen. Summary maximal 180 Zeichen.

# LENGTH BUDGET
- headline: ≤40 Zeichen.
- summary: 1–2 Sätze, ≤180 Zeichen.
- drivers[].clause: ≤80 Zeichen, eine Klausel pro Treiber.
- drivers[].delta_text: ≤40 Zeichen, z. B. "+6 bpm vs. 7-Tage-Schnitt".
- affirmation: 1 Satz, ≤140 Zeichen, ehrlich, kein Lob ohne Beleg.
- reflection: 1 offene Frage ODER ein neutraler Beobachtungssatz, ≤160 Zeichen.
- action.tiny / anchor / fallback: jeweils ≤80 Zeichen, beginnt mit Verb.
- coaching_cards[].interpretation: ≤200 Zeichen, eine Hypothese, kein Befund.

# ALLOWED VS FORBIDDEN
ERLAUBT — interpretieren, Hypothesen benennen, Experimente vorschlagen,
Konfidenz angeben:
- "RHR-Erhöhung könnte an Stress oder Infekt liegen — beobachten."
- "Schlaf und HRV laufen seit zwei Tagen runter; wirkt wie Erholungs-Defizit.
  Nicht sicher, eine Nacht früher ins Bett gibt eine Antwort."
- "Höhere Schritte korrelieren mit besserem Schlaf bei dir — könnte ein
  Hebel sein, wenn der Schlaf in den nächsten Tagen schwierig bleibt."

VERBOTEN — diagnostische Festlegung, Medikamente, Pathologisierung:
- "Du bist krank." / "Du hast einen Infekt." / "Du leidest an …"
- "Diagnose: Schlafapnoe / AFib / Burnout / Depression."
- "Nimm Ibuprofen / Melatonin / Magnesium / Vitamin D."
- "DRINGEND zum Arzt." (Hinweise auf medizinische Abklärung sind nur dann
  erlaubt, wenn eine S1-Beobachtung sie explizit vorgibt — paraphrasiere
  diese, formuliere keine eigenen.)
- Kausalbehauptungen ohne Hedging ("dein hoher Stress VERURSACHT den
  niedrigen HRV-Wert"). Verwende "könnte", "wirkt wie", "passt zu".

# WEITERE GUARDS
- KEINE Pseudo-Empathie ("ich mache mir Sorgen", "großartig!", "super!").
- KEINE Vergleiche mit anderen Nutzern.
- KEINE erfundenen Erinnerungen ("letzte Woche hast du gesagt").
- KEINE Streak-Manipulation ("dein Streak").
- KEINE Score-Verkündung ohne Einordnung ("dein Recovery ist 42").
  Wenn ein Score genannt wird, immer mit ", der …"-Relativsatz oder einem
  deutenden Verb ("wirkt", "deutet auf").
- KEINE Befehle. KEIN "du musst", "du sollst". Stattdessen "eine Möglichkeit
  wäre …", "falls es passt …", "du kannst …". Der Nutzer entscheidet.
- Wenn ein Treiber nach unten zeigt UND keine Action gesetzt ist UND
  abstain=false, MUSS die Summary das Wort "nur zur Info" enthalten oder
  abstain auf true gesetzt werden.

# ANTI-ORTHOSOMNIA
Wenn die letzten 7 Tage stabil sind und keine S1/S2-Beobachtung
vorliegt, schreibe einen kurzen, fast langweiligen Insight. Kein
Manufactured Drama. "Nichts Auffälliges, weiter so wie bisher" ist eine
gute Ausgabe.

# S1 PRIORITÄTSSPERRE
S1-Beobachtungen (tier=S1) sind Sicherheitssignale mit absoluter Priorität.
- Wenn ein S1 vorliegt, ist es immer die Hauptbotschaft des Insights —
  auch wenn parallel data_quality_* Beobachtungen feuern.
- S1-Aussagen dürfen NICHT durch Datenlücken-Hinweise relativiert werden.
  Falsch: "127 bpm, aber Tragezeit unsicher, daher unklar."
  Richtig: S1-Befund als primären Treiber; Datenlücken-Hinweis als
  eigenständigen, nachgeordneten Treiber ohne abschwächende Verknüpfung.
- Das gilt auch wenn data_quality_wear_low parallel feuert: dieser Hinweis
  kommt als Treiber Nr. 2 oder 3, nicht als Relativierung des S1.
- Verwende NIEMALS die Wendung "nur zur Info", "Datenlücke", "unsicher",
  "daher unklar" oder "Datenbasis ... schwach" in Summary, headline oder
  affirmation, wenn ein S1 vorliegt. "nur zur Info" ist ausschließlich für
  down-Treiber ohne Action und ohne S1 reserviert.

# CONFIDENCE EXPRESSION
- "confidence.value" ∈ [0,1]. Nutze 0.0 bei abstain=true.
- "confidence.calc" ist ein String, der eine Summe Σ(w·s) repräsentiert
  (z. B. "0.4*0.8 + 0.3*0.6 + 0.3*0.4 = 0.62").
- "confidence.factors" listet kurze Strings, z. B.
  "baseline_window_coverage: w=0.40 s=0.80".
- Drei Faktoren mit fixen Gewichten (w):
  - baseline_window_coverage  w=0.40
  - signal_quality            w=0.30
  - persistence_gate          w=0.30
- Score-Kalibrierung (s ∈ [0,1]) — orientiere dich am Confidence-Hinweis im
  CONTEXT (er nennt empfohlene s-Werte). Falls kein Hinweis vorliegt, nimm
  diese Tabelle:
  - baseline_window_coverage:
      n_baseline ≥ 14 → 0.9
      n_baseline ≥ 10 → 0.7
      n_baseline ≥ 7  → 0.5
      n_baseline < 7  → 0.2
  - signal_quality:
      signal_quality.ok=true und keine Issues → 0.9
      genau 1 Issue                          → 0.6
      ≥ 2 Issues oder ok=false               → 0.3
  - persistence_gate:
      Treiber-Pattern an ≥ 5 der letzten 7 Tage  → 0.8
      Treiber-Pattern an 2–4 Tagen               → 0.5
      Treiber feuert erst heute                  → 0.2
- Wenn ein Faktor unklar ist, score=0.
- Niemals confidence.value > computed_max (siehe CONTEXT.confidence_hint
  falls vorhanden) — sonst wird der Output verworfen.

# ABSTAIN
Wenn die Datenlage nicht reicht oder die Regel-Engine bereits abstain=true
gemeldet hat:
- abstain=true
- abstain_reason: kurzer englischer String (≤140 Zeichen)
- alle Prosa-Felder = null, drivers=[], action=null, confidence.value=0
- reasoning_trace enthält trotzdem 40+ Zeichen Begründung.

# I_FEEL_FINE_OVERRIDE
Setze "i_feel_fine_override" immer auf false; der Runner überschreibt diesen
Wert nach dem Modell-Aufruf aus dem Pause-State.`;

/**
 * Build the user-message payload for Stage 4.
 *
 * Layout:
 *   PERIOD: daily · {periodKey}
 *   SELECTED OBSERVATION IDS: {ids}
 *   PICKER RATIONALE: {short rationale}
 *   OBSERVATIONS:
 *     <full list>
 *   FACTS:
 *     <compact JSON>
 *   SIMILAR DAYS:
 *     <list or "(none)">
 *   PRODUCE: ...
 */
/**
 * Enumerate all numeric metric paths under `<domain>.metrics.*` in the facts
 * bundle. Used by buildDailyUser to give the LLM an explicit whitelist for
 * driver metric_ids — without it, the model improvises (e.g. routes a
 * "bedtime shifted" observation through `sleep.metrics.tst_min`).
 */
function listFactsMetricPaths(facts: FactsBundleV2): string[] {
  const paths: string[] = [];
  const domains: Array<keyof FactsBundleV2 & string> = [
    "sleep",
    "cardio",
    "activity",
    "stress",
    "body",
  ];
  for (const dom of domains) {
    const block = (facts as unknown as Record<string, unknown>)[dom];
    if (!block || typeof block !== "object") continue;
    const metrics = (block as Record<string, unknown>).metrics;
    if (!metrics || typeof metrics !== "object") continue;
    for (const [k, v] of Object.entries(metrics as Record<string, unknown>)) {
      if (typeof v === "number") paths.push(`${dom}.metrics.${k}`);
    }
  }
  return paths;
}

/**
 * Compute deterministic confidence-factor hints from the facts bundle. The
 * LLM uses these s-scores to keep its `confidence.calc` numerically grounded
 * instead of defaulting to "low" everywhere. Returns the per-factor scores
 * and the implied upper bound on `confidence.value`.
 */
export interface ConfidenceHint {
  baseline_window_coverage: number;
  signal_quality: number;
  persistence_gate: number;
  computed_max: number;
}

function maxBaselineN(facts: FactsBundleV2): number {
  let best = 0;
  const domains: Array<keyof FactsBundleV2 & string> = [
    "sleep",
    "cardio",
    "activity",
    "stress",
    "body",
  ];
  for (const dom of domains) {
    const block = (facts as unknown as Record<string, unknown>)[dom];
    if (!block || typeof block !== "object") continue;
    const baseline = (block as Record<string, unknown>).baseline;
    if (!baseline || typeof baseline !== "object") continue;
    for (const v of Object.values(baseline as Record<string, unknown>)) {
      if (v && typeof v === "object" && "n" in (v as object)) {
        const n = (v as { n?: number }).n;
        if (typeof n === "number" && n > best) best = n;
      }
    }
  }
  return best;
}

function countSignalIssues(facts: FactsBundleV2): { ok: boolean; issues: number } {
  let issues = 0;
  let anyOkFalse = false;
  const domains: Array<keyof FactsBundleV2 & string> = [
    "sleep",
    "cardio",
    "activity",
    "stress",
    "body",
  ];
  for (const dom of domains) {
    const block = (facts as unknown as Record<string, unknown>)[dom];
    if (!block || typeof block !== "object") continue;
    const sq = (block as Record<string, unknown>).signal_quality;
    if (!sq || typeof sq !== "object") continue;
    const sqRec = sq as { ok?: unknown; issues?: unknown };
    if (sqRec.ok === false) anyOkFalse = true;
    if (Array.isArray(sqRec.issues)) issues += sqRec.issues.length;
  }
  return { ok: !anyOkFalse, issues };
}

export function computeConfidenceHint(
  facts: FactsBundleV2,
  observations: Observation[],
): ConfidenceHint {
  const n = maxBaselineN(facts);
  const baseline_window_coverage =
    n >= 14 ? 0.9 : n >= 10 ? 0.7 : n >= 7 ? 0.5 : 0.2;

  const sq = countSignalIssues(facts);
  const signal_quality = !sq.ok || sq.issues >= 2 ? 0.3 : sq.issues === 1 ? 0.6 : 0.9;

  // Persistence proxy: if the rule engine surfaced ≥1 observation flagged as
  // recurring (any tier=S1/S2 today plus same tier yesterday is hard to know
  // without history; use a simple count-based heuristic on observation count).
  const persistence_gate = observations.length >= 3 ? 0.7 : observations.length >= 1 ? 0.5 : 0.2;

  const computed_max =
    0.4 * baseline_window_coverage +
    0.3 * signal_quality +
    0.3 * persistence_gate;

  return {
    baseline_window_coverage,
    signal_quality,
    persistence_gate,
    computed_max: +computed_max.toFixed(3),
  };
}

export function buildDailyUser(
  facts: FactsBundleV2,
  observations: Observation[],
  picked: PickedEvidence,
  similarDays: SimilarDay[],
  feedback: string[] = [],
): string {
  const periodKey = facts.period_key;
  const obsLines = observations.length
    ? observations
        .map((o) => {
          const delta = o.delta_text ? ` delta="${o.delta_text}"` : "";
          return `- id=${o.id} domain=${o.domain} severity=${o.severity} tier=${o.tier ?? "null"} direction=${o.direction}${delta}: ${o.text_for_llm}`;
        })
        .join("\n")
    : "(no observations — engine abstained)";

  const factsExcerpt = compactFacts(facts);
  const similarLines = similarDays.length
    ? similarDays
        .map(
          (d) =>
            `- ${d.period_key} dist=${d.distance.toFixed(3)} drivers=${
              d.shared_drivers.join(",") || "(none)"
            }`,
        )
        .join("\n")
    : "(none)";

  const feedbackBlock = feedback.length
    ? [
        `PRIORITY: dein letzter Versuch wurde abgelehnt. Behebe AUSSCHLIESSLICH die folgenden Verstöße im neuen Output:`,
        ...feedback.map((v) => `  - ${v}`),
        `Restliche Felder so wie zuvor, soweit nicht explizit beanstandet.`,
        ``,
      ]
    : [];

  const hint = computeConfidenceHint(facts, observations);
  const hintLines = [
    `CONFIDENCE_HINT (deterministisch berechnet — verwende diese s-Werte):`,
    `  baseline_window_coverage = ${hint.baseline_window_coverage}`,
    `  signal_quality           = ${hint.signal_quality}`,
    `  persistence_gate         = ${hint.persistence_gate}`,
    `  computed_max             = ${hint.computed_max}  (deine confidence.value muss ≤ diesem Wert sein)`,
  ].join("\n");

  // Metric-ID whitelist. Drivers MUST cite exactly one of these paths. Built
  // from observations + canonical facts paths so the LLM cannot re-route a
  // bedtime_shift observation into a tst_min driver (a recurring failure
  // mode caught by the paired-grounding verifier).
  const obsMetrics = new Set(
    observations.map((o) => o.metric_id).filter((m): m is string => !!m),
  );
  const factsMetrics = listFactsMetricPaths(facts);
  const allowedIds = [...new Set([...obsMetrics, ...factsMetrics])].sort();
  const allowedLines = [
    `ALLOWED_METRIC_IDS (drivers[].metric_id MUSS exakt einer dieser Pfade sein):`,
    ...allowedIds.map((m) => `  - ${m}`),
  ].join("\n");

  return [
    ...feedbackBlock,
    `PERIOD: daily · ${periodKey} (FINALISED — full 24h data)`,
    `SELECTED OBSERVATION IDS: ${picked.selected_ids.join(", ") || "(none)"}`,
    `PICKER RATIONALE: ${picked.rationale || "(deterministic fallback)"}`,
    `OBSERVATIONS:`,
    obsLines,
    `FACTS:`,
    factsExcerpt,
    `SIMILAR DAYS:`,
    similarLines,
    ``,
    hintLines,
    ``,
    allowedLines,
    `PRODUCE: daily insight for ${periodKey} in German.`,
    ``,
    `REMINDER: Output ONE JSON object with EVERY required schema property:`,
    `  reasoning_trace, schema_version="daily/v2", language="de", abstain,`,
    `  abstain_reason, headline, verdict_band, summary, drivers, affirmation,`,
    `  reflection, action, i_feel_fine_override, confidence.`,
    `Set null for prose fields when abstaining; drivers=[] and action=null in that case.`,
    `Each Driver MUST include direction ("up"|"down"|"flat"), metric_id (FACTS path),`,
    `delta_text ("+6 bpm vs. 7-Tage-Schnitt") and at least one evidence_id.`,
    `Coaching cards may include "interpretation" (≤200 chars) naming the hypothesis`,
    `behind a pattern (e.g. "RHR↑ + HRV↓ + Schlaf↓ — Erholungs-Defizit oder Infekt").`,
    `Set i_feel_fine_override=false; the runner overrides it.`,
  ].join("\n");
}

/**
 * Compact-stringify the facts bundle into a per-domain summary that fits
 * inside the user message without exhausting the context window. Only the
 * metric blocks + baselines + signal_quality are kept.
 */
function compactFacts(facts: FactsBundleV2): string {
  const blocks: string[] = [];
  const window = `data_window: ${facts.data_window.start_iso} → ${facts.data_window.end_iso} (${facts.data_window.tz})`;
  blocks.push(window);

  const domains: Array<keyof FactsBundleV2 & string> = [
    "sleep",
    "cardio",
    "activity",
    "stress",
    "body",
  ];
  for (const key of domains) {
    const block = (facts as unknown as Record<string, unknown>)[key];
    if (!block || typeof block !== "object") continue;
    blocks.push(`${key}: ${JSON.stringify(block)}`);
  }
  if (facts.anomalies) {
    blocks.push(`anomalies: ${JSON.stringify(facts.anomalies)}`);
  }
  return blocks.join("\n");
}
