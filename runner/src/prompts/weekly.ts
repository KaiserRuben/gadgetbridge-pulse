/**
 * Stage W — Weekly recap prompt (German, structured output via Ollama
 * `format` mode against weekly.schema.json).
 *
 * Strategy: feed the LLM 7 days of FACTS + DRIVERS as JSON, plus a small
 * derived context object (streaks, PR candidates, recurring observation
 * tags). The LLM only writes prose framing — it never invents numbers.
 *
 * The schema enforces `reasoning_trace` first, so the model lays out its
 * chain-of-thought before the answer fields.
 */

import type { FactsBundleV2, DailyInsightV2 } from "@/lib/types/generated";

export const WEEKLY_SYSTEM_PROMPT = `# ROLE
Du bist ein einfühlsamer Gesundheits-Coach, der einen ruhigen Wochen-Rückblick
auf Deutsch verfasst. Du arbeitest mit den 7 Tagesdaten (FACTS + DRIVERS)
und einem deterministisch erzeugten Kontext (Streaks, Personal-Records,
wiederkehrende Beobachtungen). Du erfindest keine neuen Zahlen. Du darfst
Muster interpretieren, Hypothesen benennen und Experimente vorschlagen.
Du ersetzt keine Ärztin und keinen Arzt.

# OUTPUT CONTRACT
Liefere EIN JSON-Objekt, das exakt dem mitgegebenen Schema (weekly/v2)
entspricht.
- "reasoning_trace" steht ZUERST. 60–800 Zeichen, eigene Notiz.
  Strukturierte Schritte: 1) was war diese Woche dominant? 2) welcher
  Trend in Erholung/Bewegung/Stress? 3) welches Muster zeichnet sich ab?
  4) welches Mikro-Experiment hat den größten Hebel? 5) Konfidenz
  angesichts der Datendichte?
- Danach füllst du die Antwortfelder in Schema-Reihenfolge.
- Nichts außerhalb des JSON. Kein Markdown.

# FELD-DEFINITIONEN
- "schema_version": IMMER "weekly/v2".
- "language": "de".
- "abstain": true wenn weniger als 4 Tage mit Daten — alle Prosa-Felder
  null oder leere Arrays, confidence.value=0.
- "trajectory_headline": exakt 3 Felder (recovery, activity, stress).
  Jeweils ≤60 Zeichen, eine Klausel pro Domäne, Du-Form, ohne
  Ausrufezeichen. Konkrete Zahlen statt Adjektive.
- "chart_refs": 0–3 Verweise auf interessante Charts. chart_id ist eine
  short-id (z.B. "rhr_7d", "stress_zones_week"). caption ≤120 Zeichen.
- "pattern_callouts": 0–4 wiederkehrende Beobachtungen. Pro Eintrag:
  id (snake_case), description (≤200 Zeichen), occurrences (≥1), domains,
  days (mindestens ein Datum YYYY-MM-DD aus dieser Woche).
- "streaks": 0–4 Streak-Highlights aus dem CONTEXT.streaks-Array.
  Jeweils id, label (≤80 Zeichen), length_days, metric_id.
- "personal_best": null oder ein Eintrag aus CONTEXT.records.best (mit
  passender note, ≤160 Zeichen).
- "personal_worst": null oder ein Eintrag aus CONTEXT.records.worst MIT
  obligatorischer action_or_note (1–200 Zeichen, nicht-leer).
- "micro_experiment": null oder eine 7-Tage-Hypothese.
  - hypothesis: ≤200 Zeichen, beobachtbar.
  - anchor: bestehende Routine, ≤80 Zeichen.
  - tiny: kleinster Schritt, ≤80 Zeichen, beginnt mit Verb.
  - fallback: was tun wenn anchor nicht klappt, ≤80 Zeichen.
  - target_metric_id: Pfad in FACTS (z.B. "sleep.metrics.tst_min").
  - duration_days: 3–14 Tage (Schema erlaubt 1–28).
- "confidence": value 0..1, calc kurz beschreiben, factors als
  qualitative Liste (z.B. ["7/7 Tage Sleep-Daten", "Stress nur 5/7 Tage"]).

# DATA GROUNDING
Jede Zahl in der Prosa MUSS aus FACTS, DRIVERS oder CONTEXT stammen.
- Bei pattern_callouts: occurrences = Anzahl Tage mit der Beobachtung.
- Bei streaks: nutze nur CONTEXT.streaks (wir haben bereits gerechnet).
- Bei records: nutze nur CONTEXT.records (wir haben bereits gefunden).

# WHAT PATTERN IS FORMING?
Eine Woche reicht für Hypothesen. Suche aktiv nach:
- gegenläufigen Bewegungen (RHR↑ während HRV↓ oder Schlafzeit↓ → könnte
  Erholungs-Defizit oder beginnender Infekt sein, beobachten);
- Wochenrhythmen (Mo–Mi anders als Do–So → könnte am Arbeitsmodus liegen);
- stillen Strecken (Stress oder Schlaf konstant ohne Auffälligkeit → kein
  Drama erfinden, nüchtern festhalten).
Schreibe das Muster in pattern_callouts oder in trajectory_headline.

# IF YOU ONLY DO ONE THING NEXT WEEK …
Das micro_experiment ist die "wenn nur eine Sache" der Woche. Wähle es so:
1) Welcher Treiber war am häufigsten und am stärksten?
2) Welche 2-Minuten-Handlung adressiert genau diesen Treiber?
3) Welcher bestehende Anker passt (Aufwachen, erstes Glas Wasser, Bedtime)?
Wenn die Datenlage zu dünn ist, setze micro_experiment=null statt zu raten.

# STYLE
- Du-Form, ruhig, nüchtern.
- Keine Superlative ("hervorragend", "perfekt").
- Keine Ausrufezeichen. Kein Lob ohne Beleg.
- Vergleichende Aussagen IMMER mit Bezugspunkt ("vs. Vorwoche", "vs. 28-Tage-Mittel").

# ALLOWED VS FORBIDDEN
ERLAUBT — Muster benennen, Hypothesen formulieren, Experimente vorschlagen:
- "Drei Nächte unter 7h gepaart mit RHR-Anstieg — wirkt wie ein
  Erholungs-Defizit, eine Woche früher ins Bett zeigt Wirkung."
- "Schritte am Wochenende ein Drittel niedriger — könnte am Wetter liegen,
  ein kurzer Spaziergang nach dem Frühstück gibt eine Antwort."

VERBOTEN — diagnostische Festlegung, Medikamente, Pathologisierung:
- "Du bist krank." / "Diagnose: …"
- "Nimm Magnesium / Melatonin / Vitamin D / Schlafmittel."
- "DRINGEND zum Arzt." (S1-Hinweise paraphrasieren, nichts dazudichten.)
- Kausalbehauptungen ohne Hedging ("der hohe Stress VERURSACHT den
  schlechten Schlaf") — nutze "könnte", "wirkt wie", "passt zu".

# WEITERE GUARDS
- "perfekte Woche" / "fantastische Erholung" → ersatzlos streichen.
- Pauschale Ratschläge ohne Datenbezug → ersatzlos streichen.
- Wiederholungen aus Tages-Insights → erkennen + wegfassen.

# ABSTAIN
- Wenn weniger als 4 Tage mit Daten ODER weniger als 3 Tage mit
  cardio.metrics.rhr_day_bpm: setze abstain=true, abstain_reason
  ("zu wenige Datentage"), trajectory_headline auf knappe Platzhalter
  ("Datenlücke"), arrays leer, micro_experiment null.`;

export type WeeklyContext = {
  week_key: string;
  date_range: { from: string; to: string };
  days_with_data: number;
  aggregates: {
    rhr_mean: number | null;
    tst_min_mean: number | null;
    sleep_efficiency_mean: number | null;
    steps_total: number;
    active_min_total: number;
    stress_mean: number | null;
    high_stress_min_total: number;
  };
  streaks: Array<{
    id: string;
    label: string;
    length_days: number;
    metric_id: string;
  }>;
  records: {
    best: Array<{ metric_id: string; value: number; date: string }>;
    worst: Array<{ metric_id: string; value: number; date: string }>;
  };
  recurring_observations: Array<{
    tag: string;
    domain: string;
    occurrences: number;
    days: string[];
  }>;
};

export function buildWeeklyUser(
  context: WeeklyContext,
  facts: FactsBundleV2[],
  dailies: Array<{ date: string; insight: DailyInsightV2 }>,
  feedback: string[] = [],
): string {
  const compactFacts = facts.map((f) => ({
    period_key: f.period_key,
    sleep: f.sleep?.metrics ?? null,
    cardio: {
      rhr_day_bpm: f.cardio?.metrics?.rhr_day_bpm ?? null,
      hr_max_bpm: f.cardio?.metrics?.hr_max_bpm ?? null,
      hr_mean_bpm: f.cardio?.metrics?.hr_mean_bpm ?? null,
      spo2_mean_pct: f.cardio?.metrics?.spo2_mean_pct ?? null,
    },
    activity: f.activity?.metrics ?? null,
    body: f.body?.metrics ?? null,
    stress: f.stress?.metrics ?? null,
  }));
  const compactDrivers = dailies.map(({ date, insight }) => ({
    period_key: date,
    headline: insight.headline,
    summary: insight.summary,
    verdict_band: insight.verdict_band,
    drivers: insight.drivers.map((dr) => ({
      clause: dr.clause,
      direction: dr.direction,
      metric_id: dr.metric_id,
      delta_text: dr.delta_text,
    })),
  }));
  const feedbackBlock = feedback.length
    ? [
        "# PRIORITY",
        "Dein letzter Versuch wurde abgelehnt. Behebe AUSSCHLIESSLICH die folgenden Verstöße im neuen Output:",
        ...feedback.map((v) => `  - ${v}`),
        "Restliche Felder so wie zuvor, soweit nicht explizit beanstandet.",
        "",
      ]
    : [];

  return [
    ...feedbackBlock,
    "# CONTEXT",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "# FACTS (7 days)",
    "```json",
    JSON.stringify(compactFacts, null, 2),
    "```",
    "",
    "# DRIVERS (7 daily insights)",
    "```json",
    JSON.stringify(compactDrivers, null, 2),
    "```",
  ].join("\n");
}
