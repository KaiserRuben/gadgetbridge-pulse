import "server-only";

import type {
  TrainingPlanV1,
  TrainingExerciseV1,
} from "../types/generated";

/**
 * Builds plan_v1 for the initial Reconditioning 2026 import.
 *
 * The plan-document shape is general — phases / templates / exercises /
 * progression rules are all data — so this file is the one bespoke piece
 * that maps the human-written `docs/training-plan-2026.md` into the
 * structured form. Subsequent plans are edited through the UI + proposal
 * flow and never round-trip through Markdown.
 *
 * Exercise references must exist in the seed library
 * (`runner/src/schemas/training/exercises-seed.json`); the importer
 * upserts that library before calling this so the FK references hold.
 */

export interface BuildResult {
  plan: TrainingPlanV1;
  exercises: TrainingExerciseV1[];
}

/**
 * Construct the v1 plan + return the seed exercise library that backs it.
 * Importer code calls `loadSeedExercises()` separately.
 */
export function buildReconditioning2026(now: Date = new Date()): TrainingPlanV1 {
  return {
    schema_version: "training/plan/v1",
    name: "Reconditioning 2026",
    status: "active",
    language: "de",
    created_at: now.toISOString(),
    current_phase_id: "phase_1",
    starting_position:
      "2+ Jahre Trainingspause nach jahrelangem konstantem Aufbau. Detraining heterogen (Bizeps ~-50%, Brust/Schultern ~-30%, Beine ~-20%). Wiederkehrende Trigger: episodische LWS-Spannung links bei Überkopflast, einseitige Knie-Tendinopathie bei Lastsprüngen, zwei Skidaumen-Verletzungen 2026. Recovery laut Pulse-Daten gut (TST ~9h, RMSSD-Peaks 78ms, RHR 57-64); HRV reagiert sensibel auf Lastsprünge.",
    strategy_overview:
      "Drei-Phasen-Aufbau: Phase 1 Reconditioning (Wochen 1-5, 3× Ganzkörper + 2× Cardio, RPE 6-7), Phase 2 Hypertrophie (6-13, Volumen + Lat/Core), Phase 3 Powerbuilding (14+, Kraft × Ästhetik). Drei Bedingungen über alle Phasen: kein reines vertikales Überkopf bis Rücken-Trigger ≥4 Wochen abwesend; keine Lastsprünge auf die Knie; Symptom → Rückzug, nicht durchziehen.",
    global_constraints: [
      "Kein reines vertikales Überkopfdrücken bis Rücken-Trigger ≥4 Wochen abwesend war (frühestens Phase 3). Landmine Press als Substitut.",
      "Keine Lastsprünge auf die Knie. Low-impact Cardio, keine Jumps in Phase 1+2, schrittweise Sehnenanpassung.",
      "Symptom in Session → sofortiger Rückzug, kein Durchziehen. Phase verlängert sich; das ist Feature, nicht Bug.",
    ],
    injury_protocol: [
      {
        symptom: "Rücken links spannt >24 h nach Session",
        action: "Trigger-Übung 2 Wochen raus, dann -50% Last Wiedereinstieg",
        trigger_location_codes: ["back"],
        severity: "warn",
      },
      {
        symptom: "Rücken-Trigger ≥3× in 4 Wochen",
        action: "Plan stoppen, Sportphysio-Termin verpflichtend",
        trigger_location_codes: ["back"],
        severity: "critical",
      },
      {
        symptom: "Einseitiger Knie-Sehnenschmerz",
        action: "Cardio 1 Woche raus, Step-Ups raus, nur Oberkörper",
        trigger_location_codes: ["knee"],
        severity: "warn",
      },
      {
        symptom: "Knieschmerz + Schwellung",
        action: "Stopp, Orthopäde",
        trigger_location_codes: ["knee"],
        severity: "critical",
      },
      {
        symptom: "Daumenschmerz bei Griff",
        action: "Zughilfen an allen Pulls, Hangs raus",
        trigger_location_codes: ["thumb"],
        severity: "warn",
      },
      {
        symptom: "HRV <30 ms morgens",
        action: "Session mit 50% Volumen oder Wechsel auf Z1 Cardio",
        severity: "warn",
      },
      {
        symptom: "RHR >70 morgens",
        action: "Session ausfallen lassen oder leicht ersetzen",
        severity: "warn",
      },
    ],
    cardio_guidance: {
      frequency_per_week: 2,
      z2_minutes_target: 30,
      z3_allowed: false,
      banned_modes: ["jogging", "hiit", "jumps", "bouldering"],
      priority_modes: ["swimming", "rowing_ergo", "crosstrainer"],
      note: "2×/Woche 25-35 min Z2 (~130-150 bpm). Priorität 1: Schwimmen (Wellpass). Priorität 2: Rudern (Lat-Bonus, nur bei sauberer Form). Priorität 3: Crosstrainer (langweilig aber sicher).",
    },
    tracking_cadence: {
      session_logging: "Nach jeder Session: Gewichte/Wiederholungen/RPE in Pulse loggen.",
      weekly_review_dow: 0,
      measurement_interval_weeks: 4,
    },
    todos: [
      "Sportphysio-Termin in München buchen (Skapula, LWS, Knie, Daumen)",
      "InBody-Baseline bei SoulPlus (Gewicht, KFA%, Skelettmuskel)",
      "Zughilfen kaufen (~€15)",
      "Wellpass-Schwimmbad identifizieren",
      "Flache Schuhe für Squat/Hinge",
      "Ernährungsplan-Termin (~1.8 g Protein/kg/Tag = ~150 g/Tag)",
      "Woche 4-5: Phase-2-Details finalisieren",
    ],
    phases: [
      {
        id: "phase_1",
        label: "Phase 1 — Reconditioning",
        label_long: "Phase 1: Reconditioning — Bewegungsqualität + Sehnenanpassung + neuromuskuläres Priming",
        goal:
          "Bewegungsqualität, Sehnenanpassung, neuromuskuläres Priming nach 2+ Jahren Pause. Submaximal, high-rep, RPE 6-7.",
        character: "3× Ganzkörper unterschiedlicher Fokus + 2× Cardio. Submaximal, RPE 6-7, niemals bis Versagen.",
        started_at: "2026-05-18",
        planned_through: "2026-06-21",
        intensity_guidance: {
          rpe_floor: 6,
          rpe_ceiling: 7,
          rir_min: 3,
          note: "3-4 Wiederholungen in Reserve am Ende jedes Satzes. Wenn alle Sätze sauber + keine 24-h-Beschwerden → nächste Session +5% Last oder +1 Wiederholung.",
        },
        progression_rule:
          "Wenn alle Sätze sauber UND keine Beschwerden in 24 h → +5% Last ODER +1 Wiederholung in der nächsten Session.",
        constraints: [
          "RPE-Ceiling 7. Nicht bis Versagen.",
          "3-4 Reps in Reserve am Satzende.",
        ],
        entry_criteria: [
          {
            id: "phase1_entry_immediate",
            description: "Sofort beginnen — keine Vorbedingung außer dem One-off Phase-0 Setup.",
            kind: "manual",
          },
        ],
        schedule_hint: {
          weekly_pattern: [
            "phase1_a",
            "cardio",
            "phase1_b",
            "rest",
            "phase1_c",
            "cardio",
            "rest",
          ],
          frequency_per_week: 3,
        },
        session_templates: [
          {
            id: "phase1_a",
            label: "Tag A — Push-dominant",
            category: "strength",
            estimated_duration_min: 75,
            warmup_text:
              "5 min Mobility: Cat-Cow + Scapular Wall Slide + Hip 90/90. Kein Schweißausbruch.",
            cooldown_text: "5 min Crosstrainer Z1.",
            exercises: [
              {
                exercise_id: "goblet_squat",
                order_idx: 0,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  load_kg_min: 12,
                  load_kg_max: 16,
                  load_note: "12-16 kg",
                  rpe_target: 6.5,
                },
                notes: "Volle ROM, Knie verfolgt Zehen.",
              },
              {
                exercise_id: "landmine_press_sa",
                order_idx: 1,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  reps_per_side: true,
                  load_note: "Leichte Stange + 5 kg",
                  rpe_target: 6.5,
                },
                notes: "OHP-Substitut, diagonaler Druck, rückenfreundlich.",
              },
              {
                exercise_id: "chest_press_machine",
                order_idx: 2,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 30,
                  load_kg_max: 30,
                  load_note: "~30 kg Start",
                  rpe_target: 6.5,
                },
                notes: "Keine Langhantel-Bank in Phase 1.",
              },
              {
                exercise_id: "cable_row_seated",
                order_idx: 3,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 30,
                  load_kg_max: 30,
                  load_note: "~30 kg",
                  rpe_target: 6.5,
                },
                notes: "Aktive Skapula-Retraktion.",
              },
              {
                exercise_id: "dead_bug",
                order_idx: 4,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  reps_per_side: true,
                  load_note: "BW",
                },
                notes: "Anti-Extension Core.",
              },
              {
                exercise_id: "plank",
                order_idx: 5,
                prescription: {
                  sets: 3,
                  duration_sec: 30,
                  load_note: "—",
                },
                notes: "Brace, Hüfte nicht durchhängen lassen.",
              },
            ],
          },
          {
            id: "phase1_b",
            label: "Tag B — Pull-dominant (Lat-Fokus)",
            category: "strength",
            estimated_duration_min: 80,
            warmup_text: "5 min Mobility: Band Pull-Apart + Lat-Stretch + Bird Dog.",
            cooldown_text: "Optional 5 min Z1 zum Runterkommen.",
            exercises: [
              {
                exercise_id: "lat_pulldown_wide",
                order_idx: 0,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 30,
                  load_kg_max: 30,
                  load_note: "~30 kg Start",
                  rpe_target: 6.5,
                },
                notes: "Brust hoch, Skapula runter/zurück.",
              },
              {
                exercise_id: "lat_pulldown_neutral",
                order_idx: 1,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 30,
                  load_kg_max: 30,
                  load_note: "~30 kg",
                  rpe_target: 6.5,
                },
                notes: "Anderer Faser-Winkel.",
              },
              {
                exercise_id: "romanian_deadlift_db",
                order_idx: 2,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  load_kg_min: 8,
                  load_kg_max: 12,
                  load_note: "2× 8-12 kg",
                  rpe_target: 6,
                },
                notes: "LEICHT. Hinge-Pattern ohne axiale Spitzenlast.",
              },
              {
                exercise_id: "chest_supported_row",
                order_idx: 3,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 25,
                  load_kg_max: 25,
                  load_note: "~25 kg/Seite",
                  rpe_target: 6.5,
                },
                notes: "Mid-Back-Fokus, rückenfreundlich.",
              },
              {
                exercise_id: "reverse_fly",
                order_idx: 4,
                prescription: {
                  sets: 3,
                  reps_min: 15,
                  reps_max: 15,
                  load_kg_min: 10,
                  load_kg_max: 10,
                  load_note: "~10 kg",
                  rpe_target: 6,
                },
                notes: "Hintere Schulter.",
              },
              {
                exercise_id: "pallof_press",
                order_idx: 5,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  reps_per_side: true,
                  load_note: "Mittleres Band",
                },
                notes: "Anti-Rotation Core.",
              },
              {
                exercise_id: "dead_hang",
                order_idx: 6,
                prescription: {
                  sets: 3,
                  duration_sec: 25,
                  load_note: "BW",
                },
                notes: "Daumen-Belastungstest + Lat-Stretch. Zughilfen erlaubt.",
              },
            ],
          },
          {
            id: "phase1_c",
            label: "Tag C — Beine + Conditioning",
            category: "strength",
            estimated_duration_min: 85,
            warmup_text:
              "5 min: Leichtes Skipping 3 min + Glute Bridge + Leg Swing. Achtung: kein echter Jump.",
            cooldown_text: "Optional kurzer Crosstrainer-Auslauf.",
            exercises: [
              {
                exercise_id: "leg_press",
                order_idx: 0,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 80,
                  load_kg_max: 100,
                  load_note: "80-100 kg Start",
                  rpe_target: 6.5,
                },
                notes: "Kontrolliert, volle ROM.",
              },
              {
                exercise_id: "hip_thrust",
                order_idx: 1,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  load_kg_min: 30,
                  load_kg_max: 30,
                  load_note: "~30 kg",
                  rpe_target: 6.5,
                },
                notes: "Glute-Fokus, oben kurz halten.",
              },
              {
                exercise_id: "lying_leg_curl",
                order_idx: 2,
                prescription: {
                  sets: 3,
                  reps_min: 12,
                  reps_max: 12,
                  load_kg_min: 25,
                  load_kg_max: 25,
                  load_note: "~25 kg",
                  rpe_target: 6.5,
                },
                notes: "Hamstring-Isolation.",
              },
              {
                exercise_id: "step_up",
                order_idx: 3,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  reps_per_side: true,
                  load_note: "BW oder leichte KH",
                },
                notes: "Schrittweise Knie-Sehnen-Belastung, unilateral. Box ~40 cm.",
              },
              {
                exercise_id: "calf_raise",
                order_idx: 4,
                prescription: {
                  sets: 3,
                  reps_min: 15,
                  reps_max: 15,
                  load_kg_min: 30,
                  load_kg_max: 30,
                  load_note: "~30 kg",
                  rpe_target: 6,
                },
              },
              {
                exercise_id: "farmers_walk",
                order_idx: 5,
                prescription: {
                  sets: 3,
                  distance_m: 40,
                  load_kg_min: 15,
                  load_kg_max: 20,
                  load_note: "2× 15-20 kg",
                  rpe_target: 6.5,
                },
                notes: "Griff + Core + Haltung. KEINE Zughilfen — Daumen-Reha.",
              },
              {
                exercise_id: "hanging_knee_raise",
                order_idx: 6,
                prescription: {
                  sets: 3,
                  reps_min: 10,
                  reps_max: 10,
                  load_note: "BW",
                },
                notes: "Core + Daumen-Hang. Zughilfen erlaubt.",
              },
            ],
          },
        ],
      },
      {
        id: "phase_2",
        label: "Phase 2 — Hypertrophie",
        label_long: "Phase 2: Hypertrophie — Muskelaufbau mit Lat/Core-Fokus",
        goal: "Muskelaufbau, Lat- und Core-Fokus. Wird in Wochen 4-5 basierend auf Phase-1-Leistung finalisiert.",
        character: "3× Upper/Lower-Hybrid (4× wenn HRV/Sleep es zulassen) + 2× Cardio. Volumen-orientiert, RPE 7-8.5.",
        intensity_guidance: { rpe_floor: 7, rpe_ceiling: 8.5, note: "Volumen-fokussiert." },
        entry_criteria: [
          {
            id: "phase2_no_back_trigger_5w",
            description: "Volle 5 Wochen ohne Rücken-Trigger.",
            kind: "symptom_absence",
            param_json: { location_code: "back", window_weeks: 5 },
          },
          {
            id: "phase2_knees_pain_free",
            description: "Knie schmerzfrei in allen Bewegungen inkl. Step-Ups.",
            kind: "symptom_absence",
            param_json: { location_code: "knee", window_weeks: 4 },
          },
          {
            id: "phase2_goblet_20kg",
            description: "Goblet Squat 3×10 mit 20 kg sauber.",
            kind: "load",
            param_json: { exercise_id: "goblet_squat", sets: 3, reps: 10, load_kg: 20 },
          },
          {
            id: "phase2_lat_pulldown_40kg",
            description: "Lat Pulldown 3×12 mit 40 kg sauber.",
            kind: "load",
            param_json: { exercise_id: "lat_pulldown_wide", sets: 3, reps: 12, load_kg: 40 },
          },
        ],
        session_templates: [],
      },
      {
        id: "phase_3",
        label: "Phase 3 — Powerbuilding",
        label_long: "Phase 3: Powerbuilding — Kraft × Ästhetik",
        goal: "Kraft × Ästhetik. Periodisiert. Details werden erst nach Phase-2-Abschluss festgelegt.",
        character: "3-4×/Woche, schwere Compounds, periodisiert.",
        entry_criteria: [
          {
            id: "phase3_clean_phase2",
            description: "Phase 2 sauber abgeschlossen.",
            kind: "manual",
          },
          {
            id: "phase3_80pct_historic",
            description: "Hauptlifte bei ≥80% der historischen Zahlen.",
            kind: "load",
            param_json: { threshold_pct: 80 },
          },
          {
            id: "phase3_overhead_test",
            description: "Rücken stabil bei moderatem Überkopf-Test (Maschinen-Schulterdrücken 3×10 mit ~30 kg sauber).",
            kind: "load",
            param_json: { exercise_id: "machine_shoulder_press", sets: 3, reps: 10, load_kg: 30 },
          },
        ],
        session_templates: [],
      },
    ],
  };
}
