// AUTO-GENERATED FILE — do not edit.
// Source: runner/src/schemas/{v2,training}/*.schema.json
// Run `npm run gen:types` to regenerate.

// ════════ v2 ════════

// ── v2/alarm-state.schema.json ──
/**
 * Mutable alarm state file kept in the bidirectional Syncthing folder.
 */
export interface AlarmStateV1 {
  schema_version: "state/v1";
  /**
   * Map of alarm_id -> ISO date until which the alarm is snoozed.
   */
  snooze_until: {
    [k: string]: string | undefined;
  };
  /**
   * Map of alarm_id -> number of times the alarm has been dismissed.
   */
  dismissed_counts: {
    [k: string]: number | undefined;
  };
  /**
   * Observation IDs the user has muted.
   */
  muted_topics: string[];
}

// ── v2/alarms.schema.json ──
/**
 * Append-only event log per month for fired alarms.
 */
export interface AlarmsV2 {
  schema_version: "alarms/v2";
  /**
   * ISO month YYYY-MM identifying the month-bucket file.
   */
  month_key: string;
  events: AlarmEvent[];
}
export interface AlarmEvent {
  /**
   * snake_case identifier of the alarm rule.
   */
  alarm_id: string;
  fired_at: string;
  period_key: string;
  tier: "S1" | "S2" | "S3";
  domain: string;
  metric: string;
  severity_label: "soft" | "hard";
  gate_triggered: "z_score" | "absolute" | "duration" | "pattern" | "compound";
  z_score: number | null;
  /**
   * @minItems 1
   * @maxItems 7
   */
  evidence_window:
    | [
        {
          period_key: string;
          value: number | null;
        }
      ]
    | [
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        }
      ]
    | [
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        }
      ]
    | [
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        }
      ]
    | [
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        }
      ]
    | [
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        }
      ]
    | [
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        },
        {
          period_key: string;
          value: number | null;
        }
      ];
  dismissed: boolean;
  dismissed_at: null | string;
  dismissed_reason: string | null;
}

// ── v2/bundle.schema.json ──
/**
 * Run manifest describing the lifecycle of a single pipeline run.
 */
export interface BundleManifestV2 {
  schema_version: "bundle/v2";
  period_key: string;
  timeframe: "daily" | "weekly";
  run_id: string;
  started_at: string;
  updated_at: string;
  pipeline_status: "running" | "ok" | "partial" | "failed" | "abstained" | "live";
  model: string;
  model_version: string;
  runs: StageRecord[];
  /**
   * Map of stage name -> duration in milliseconds.
   */
  timings: {
    [k: string]: number | undefined;
  };
}
export interface StageRecord {
  stage: string;
  status: "ok" | "partial" | "failed" | "skipped" | "abstained";
  started_at: string;
  ended_at: null | string;
  error: string | null;
}

// ── v2/daily.schema.json ──
/**
 * Daily insight payload produced by the prose model (Ollama format mode). reasoning_trace is FIRST so the model fills it before any answer field.
 */
export interface DailyInsightV2 {
  /**
   * Chain-of-thought trace produced before the answer fields. MUST be the first property.
   */
  reasoning_trace: string;
  schema_version: "daily/v2" | "daily/v2.1" | "daily/v2.2";
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  headline: string | null;
  verdict_band: "steady" | "above_usual" | "below_usual" | null;
  summary: string | null;
  /**
   * @minItems 0
   * @maxItems 3
   */
  drivers: [] | [Driver] | [Driver, Driver] | [Driver, Driver, Driver];
  affirmation: string | null;
  reflection: string | null;
  action: null | Action;
  i_feel_fine_override: boolean;
  confidence: Confidence;
  /**
   * Optional per-lever CoachCards (Phase 3 analyzer stage). Additive in daily/v2.1.
   *
   * @maxItems 4
   */
  coaching_cards?:
    | []
    | [
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        }
      ]
    | [
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        },
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        }
      ]
    | [
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        },
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        },
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        }
      ]
    | [
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        },
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        },
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        },
        {
          lever: string;
          domain: string;
          confidence: "high" | "medium" | "low";
          trajectory: string;
          projection_90d: string;
          /**
           * Optional hypothesis naming what might be going on (e.g. 'RHR-Erhoehung + HRV-Abfall + Schlaf kurz — wirkt wie Erholungs-Defizit oder beginnender Infekt').
           */
          interpretation?: string | null;
          tiny_next_step: {
            anchor: string;
            tiny: string;
            horizon: "today" | "tonight" | "tomorrow" | "this_week";
          };
        }
      ];
  /**
   * Optional surprise-ranked insights (Phase 3 analyzer stage). Additive in daily/v2.2. Ranked deterministically by |z|; LLM only writes the headline + reason framing.
   *
   * @maxItems 5
   */
  surprise_insights?:
    | []
    | [
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        }
      ]
    | [
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        }
      ]
    | [
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        }
      ]
    | [
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        }
      ]
    | [
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        },
        {
          metric: string;
          metric_label_de: string;
          today_value: number;
          baseline_mean: number;
          baseline_std: number;
          z_score: number;
          surprise_label: "high" | "medium" | "low";
          direction: "up" | "down";
          n_baseline: number;
          fragile: boolean;
          headline_de: string;
          reason_de: string;
        }
      ];
}
export interface Driver {
  clause: string;
  metric_id: string;
  delta_text: string;
  direction: "up" | "down" | "flat";
  /**
   * @minItems 1
   */
  evidence_ids: [string, ...string[]];
}
export interface Action {
  anchor: string;
  tiny: string;
  fallback: string;
  horizon: "today" | "tonight" | "tomorrow" | "this_week";
}
export interface Confidence {
  value: number;
  calc: string;
  factors: string[];
}

// ── v2/facts.schema.json ──
export type BaselineMap = null | {
  [k: string]: BaselineCore | undefined;
};

/**
 * Deterministic facts bundle assembled from raw GadgetBridge samples for a single period_key. Pure data, no narrative.
 */
export interface FactsBundleV2 {
  schema_version: "facts/v2" | "facts/v2.1";
  /**
   * ISO date YYYY-MM-DD identifying the period the bundle covers.
   */
  period_key: string;
  generated_at: string;
  data_window: {
    start_iso: string;
    end_iso: string;
    /**
     * IANA timezone identifier, e.g. Europe/Berlin.
     */
    tz: string;
  };
  samples_seen: {
    sleep_rows: number;
    hr_rows: number;
    spo2_rows: number;
    stress_rows: number;
    step_rows: number;
    weight_rows: number;
  };
  user: {
    age: number | null;
    sex: "m" | "f" | "x" | null;
    height_cm: number | null;
  };
  device: {
    model: string | null;
    firmware: string | null;
    wear_seconds_24h: number | null;
    battery?: null | {
      min_pct: number | null;
      max_pct: number | null;
      mean_pct: number | null;
      samples: number;
      [k: string]: unknown | undefined;
    };
  };
  sleep: null | {
    metrics: {
      tst_min: number | null;
      sleep_efficiency_pct: number | null;
      rem_min: number | null;
      deep_min: number | null;
      light_min: number | null;
      awake_min: number | null;
      rhr_sleep_bpm: number | null;
      rmssd_ms: number | null;
      spo2_min_pct: number | null;
      breath_rate_mean?: number | null;
      wake_count?: number | null;
      rdi?: number | null;
      hr_min_sleep?: number | null;
      hr_max_sleep?: number | null;
      sleep_latency_min?: number | null;
      apnea_events_count?: number | null;
      apnea_max_level?: number | null;
      [k: string]: unknown | undefined;
    };
    baseline: BaselineMap;
    signal_quality: SignalQuality;
    [k: string]: unknown | undefined;
  };
  cardio: {
    metrics: {
      rhr_day_bpm: number | null;
      hr_max_bpm: number | null;
      hr_mean_bpm: number | null;
      spo2_mean_pct: number | null;
    };
    baseline: BaselineMap;
    signal_quality: SignalQuality;
    hrv_series?:
      | null
      | {
          ts_iso: string;
          value_ms: number;
        }[];
    [k: string]: unknown | undefined;
  };
  activity: {
    metrics: {
      steps: number | null;
      active_minutes: number | null;
      sedentary_minutes: number | null;
      calories_kcal: number | null;
      distance_m?: number | null;
      [k: string]: unknown | undefined;
    };
    baseline: BaselineMap;
    signal_quality: SignalQuality;
  };
  stress: {
    metrics: {
      stress_mean: number | null;
      stress_max: number | null;
      high_stress_minutes: number | null;
    };
    baseline: BaselineMap;
    signal_quality: SignalQuality;
  };
  body: {
    metrics: {
      weight_kg: number | null;
      body_fat_pct: number | null;
      bmi: number | null;
      skin_temp_median?: number | null;
      skin_temp_delta_c?: number | null;
      [k: string]: unknown | undefined;
    };
    baseline: BaselineMap;
    signal_quality: SignalQuality;
  };
  anomalies: {
    hr_overflow_rows: number;
    negative_step_rows: number;
    data_notes: string[];
  };
  workouts: null | WorkoutFactsItem[];
  ecg: null;
  journal: null;
  meal: null;
  cycle: null;
}
export interface BaselineCore {
  median: number | null;
  mad: number | null;
  n: number;
  window_days: number;
}
export interface SignalQuality {
  ok: boolean;
  issues: string[];
}
export interface WorkoutFactsItem {
  id: number;
  type: number;
  start_iso: string;
  duration_s: number;
  distance_m?: number | null;
  steps?: number | null;
  calories_kcal?: number | null;
  workout_load?: number | null;
  aerobic_effect?: number | null;
  recovery_h?: number | null;
  hr: null | WorkoutHRStats;
}
export interface WorkoutHRStats {
  avg: number | null;
  max: number | null;
  min: number | null;
  samples: number;
  zone_secs: {
    z1: number;
    z2: number;
    z3: number;
    z4: number;
    z5: number;
  };
  drift_bpm_per_min: number | null;
}

// ── v2/labs.schema.json ──
/**
 * Opt-in feature flags for experimental lab features.
 */
export interface LabsV1 {
  schema_version: "state/v1";
  features: {
    cycle: boolean;
    training_load: boolean;
    illness_watch: boolean;
    similar_day_search: boolean;
    meal_photo: boolean;
    voice_journal: boolean;
    ecg: boolean;
  };
}

// ── v2/pause.schema.json ──
/**
 * Pause toggle, 'I feel fine' override, language preference, and step-change detection state.
 */
export interface PauseStateV1 {
  schema_version: "state/v1";
  paused: boolean;
  i_feel_fine: boolean;
  /**
   * Auto-expires at midnight; set by UI when the user activates 'I feel fine'.
   */
  i_feel_fine_until_iso: null | string;
  language: "de" | "en";
  /**
   * ISO date of the last DST/firmware/travel step-change detection.
   */
  step_change_detected_on: null | string;
}

// ── v2/weekly.schema.json ──
/**
 * Weekly recap payload. reasoning_trace is FIRST so the model fills it before any answer field.
 */
export interface WeeklyRecapV2 {
  /**
   * Chain-of-thought trace produced before the answer fields. MUST be the first property.
   */
  reasoning_trace: string;
  schema_version: "weekly/v2";
  language: "de" | "en";
  abstain: boolean;
  abstain_reason: string | null;
  trajectory_headline: {
    recovery: string;
    activity: string;
    stress: string;
  };
  /**
   * @minItems 0
   * @maxItems 3
   */
  chart_refs: [] | [ChartRef] | [ChartRef, ChartRef] | [ChartRef, ChartRef, ChartRef];
  /**
   * @minItems 0
   * @maxItems 4
   */
  pattern_callouts:
    | []
    | [PatternCallout]
    | [PatternCallout, PatternCallout]
    | [PatternCallout, PatternCallout, PatternCallout]
    | [PatternCallout, PatternCallout, PatternCallout, PatternCallout];
  /**
   * @minItems 0
   * @maxItems 4
   */
  streaks: [] | [Streak] | [Streak, Streak] | [Streak, Streak, Streak] | [Streak, Streak, Streak, Streak];
  personal_best: null | PersonalRecord;
  personal_worst: null | PersonalWorst;
  micro_experiment: null | MicroExperiment;
  confidence: Confidence;
}
export interface ChartRef {
  chart_id: string;
  caption: string;
}
export interface PatternCallout {
  id: string;
  description: string;
  occurrences: number;
  /**
   * @minItems 0
   */
  domains: string[];
  /**
   * @minItems 0
   */
  days: string[];
}
export interface Streak {
  id: string;
  label: string;
  length_days: number;
  metric_id: string;
}
export interface PersonalRecord {
  metric_id: string;
  value: number;
  date: string;
  note: string | null;
}
export interface PersonalWorst {
  metric_id: string;
  value: number;
  date: string;
  /**
   * Optional accompanying action or note when surfacing a personal worst. Repair pass fills a default if empty.
   */
  action_or_note: string;
}
export interface MicroExperiment {
  hypothesis: string;
  anchor: string;
  tiny: string;
  fallback: string;
  target_metric_id: string;
  duration_days: number;
}
export interface Confidence {
  value: number;
  calc: string;
  factors: string[];
}

// ════════ training ════════

// ── training/actual-session.schema.json ──
/**
 * A session the user has started or completed. May or may not correspond to a PlannedSession. Pi-owned (PULSE_ACTUAL_SESSION).
 */
export interface ActualSessionV1 {
  schema_version: "training/actual_session/v1";
  id: string;
  /**
   * Wake-date local key (Europe/Berlin), via runner period.ts.
   */
  period_key: string;
  plan_version: number;
  planned_session_id?: number | null;
  session_template_id?: string | null;
  deviation_reason?: "user_choice" | "recovery" | "schedule" | "other" | null;
  state: "in_progress" | "completed" | "abandoned";
  started_at: string;
  completed_at?: string | null;
  subjective_energy?: number | null;
  note?: string | null;
  wearable_workout_id?: number | null;
  wearable_link_status?: "none" | "tentative" | "confirmed" | "manual";
  wearable_link_resolved_at?: string | null;
  last_edited_at?: string | null;
}

// ── training/adjustment-proposal.schema.json ──
/**
 * An LLM-generated proposed change to the active training plan. Always reviewed by the user before being applied. Acceptance produces plan_v(n+1).
 */
export interface TrainingAdjustmentProposalV1 {
  schema_version: "training/adjustment_proposal/v1";
  id: number;
  generated_at: string;
  model?: string | null;
  prompt_version?: string | null;
  target_plan_version: number;
  scope: "exercise" | "session_template" | "phase" | "global";
  /**
   * @minItems 1
   */
  diff: [DiffOp, ...DiffOp[]];
  reasoning_trace: string;
  summary_de?: string | null;
  cited_data: Citation[];
  status: "pending" | "accepted" | "rejected" | "edited";
  resolved_at?: string | null;
  /**
   * User's free-text reason for accept/reject/edit. Feeds future LLM context.
   */
  resolution_note?: string | null;
}
export interface DiffOp {
  op: "set" | "insert" | "remove" | "replace";
  /**
   * JSON Pointer into plan payload
   */
  path: string;
  before?: unknown;
  after?: unknown;
  human_de?: string | null;
}
export interface Citation {
  kind:
    | "set_log"
    | "pain_flag"
    | "actual_session"
    | "recovery_metric"
    | "sleep_metric"
    | "activity_metric"
    | "workout"
    | "plan_version"
    | "resolution_note"
    | "other";
  ref_id: string;
  summary: string;
}

// ── training/chat-message.schema.json ──
/**
 * One row in PULSE_CHAT_QUEUE / PULSE_CHAT_MESSAGE. User questions are queued when the remote Ollama endpoint is unreachable; assistant replies stream back via the worker.
 */
export interface TrainingChatMessageV1 {
  schema_version: "training/chat_message/v1";
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system";
  created_at: string;
  delivered_at?: string | null;
  status: "queued" | "in_flight" | "delivered" | "failed" | "cancelled";
  content?: string | null;
  /**
   * Frozen plan + recent-session bundle attached to the user question at send time. Assistant reply re-uses this rather than re-fetching.
   */
  context_snapshot?: {
    [k: string]: unknown | undefined;
  } | null;
  model?: string | null;
  endpoint?: "remote" | "local" | null;
  /**
   * If the assistant suggested a plan change, the corresponding PULSE_ADJUSTMENT_PROPOSAL row id.
   */
  extracted_proposal_id?: number | null;
  error?: string | null;
}

// ── training/exercise.schema.json ──
/**
 * Canonical exercise definition. The exercise library is the stable reference for plan prescriptions and set logs. New entries added via UI/admin script — no enum migration needed.
 */
export interface TrainingExerciseV1 {
  schema_version: "training/exercise/v1";
  /**
   * Stable lower-snake_case identifier. Never renamed once shipped.
   */
  id: string;
  display_de: string;
  display_en?: string | null;
  movement_pattern:
    | "squat"
    | "hinge"
    | "push_horizontal"
    | "push_vertical"
    | "pull_horizontal"
    | "pull_vertical"
    | "carry"
    | "lunge"
    | "core_anti_extension"
    | "core_anti_rotation"
    | "core_anti_lateral_flexion"
    | "isolation_lower"
    | "isolation_upper"
    | "conditioning"
    | "mobility";
  primary_muscles?: string[];
  /**
   * @minItems 1
   */
  equipment: [
    (
      | "bodyweight"
      | "barbell"
      | "dumbbell"
      | "kettlebell"
      | "cable"
      | "machine"
      | "smith"
      | "band"
      | "trap_bar"
      | "landmine"
      | "ez_bar"
      | "pull_up_bar"
      | "box"
      | "bench"
      | "sled"
      | "ergometer"
      | "treadmill"
      | "pool"
      | "open_water"
      | "outdoor"
      | "other"
    ),
    ...(
      | "bodyweight"
      | "barbell"
      | "dumbbell"
      | "kettlebell"
      | "cable"
      | "machine"
      | "smith"
      | "band"
      | "trap_bar"
      | "landmine"
      | "ez_bar"
      | "pull_up_bar"
      | "box"
      | "bench"
      | "sled"
      | "ergometer"
      | "treadmill"
      | "pool"
      | "open_water"
      | "outdoor"
      | "other"
    )[]
  ];
  /**
   * Other exercise_ids that load the same pattern with different equipment / contraindications.
   */
  substitutes?: string[];
  /**
   * Pain location codes for which this exercise should be substituted or avoided.
   */
  contraindications?: (
    | "back"
    | "shoulder"
    | "elbow"
    | "wrist"
    | "thumb"
    | "hip"
    | "knee"
    | "ankle"
    | "foot"
    | "neck"
    | "head"
    | "chest"
    | "abdominal"
    | "other"
  )[];
  unilateral?: boolean;
  tags?: string[];
  notes_de?: string | null;
}

// ── training/pain-flag.schema.json ──
/**
 * Closed, general body-region vocabulary. Extending requires a migration.
 */
export type LocationCode =
  | "back"
  | "shoulder"
  | "elbow"
  | "wrist"
  | "thumb"
  | "hip"
  | "knee"
  | "ankle"
  | "foot"
  | "neck"
  | "head"
  | "chest"
  | "abdominal"
  | "other";

/**
 * First-class pain/discomfort event. Structured (location_code + side) drives aggregation and recurrence alarms; free_text is verbatim user input for per-flag LLM zoom-in (echo-verbatim-or-omit; never paraphrased or grouped on).
 */
export interface TrainingPainFlagV1 {
  schema_version: "training/pain_flag/v1";
  id: number;
  actual_session_id: string;
  exercise_id?: string | null;
  set_log_id?: number | null;
  location_code: LocationCode;
  side: "left" | "right" | "bilateral" | "n_a";
  severity: "mild" | "sharp";
  /**
   * Verbatim user input. Carried into per-flag LLM zoom-in; never paraphrased; never grouped on.
   */
  free_text?: string | null;
  raised_at: string;
}

// ── training/planned-session.schema.json ──
/**
 * Materialised view of a session-template-for-a-date. Created lazily on first read of a given (period_key, plan_version) and re-materialised when plan_version advances. Decoupling planning from logging means the user sees frozen prescription numbers even if the plan changes mid-week.
 */
export interface PlannedSessionV1 {
  schema_version: "training/planned_session/v1";
  id: number;
  period_key: string;
  plan_version: number;
  session_template_id: string;
  target: SessionTemplate;
  created_at?: string;
}
export interface SessionTemplate {
  id: string;
  label: string;
  category?: "strength" | "conditioning" | "mobility" | "recovery" | "custom";
  estimated_duration_min?: number | null;
  warmup_text?: string | null;
  cooldown_text?: string | null;
  exercises: PrescribedExercise[];
}
export interface PrescribedExercise {
  exercise_id: string;
  order_idx: number;
  prescription: Prescription;
  notes?: string | null;
  warmup_only?: boolean;
}
export interface Prescription {
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  reps_per_side?: boolean;
  load_kg_min?: number | null;
  load_kg_max?: number | null;
  load_note?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  rpe_target?: number | null;
  rest_sec?: number | null;
}

// ── training/set-log.schema.json ──
/**
 * One set logged by the user during an actual session. Generic: covers reps/weight strength sets, time/distance conditioning sets, and BW holds via nullable variant fields.
 */
export interface TrainingSetLogV1 {
  schema_version: "training/set_log/v1";
  id: number;
  actual_session_id: string;
  exercise_id: string;
  set_idx: number;
  reps?: number | null;
  weight_kg?: number | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
  rir?: number | null;
  side?: "both" | "left" | "right" | null;
  note?: string | null;
  logged_at: string;
  last_edited_at?: string | null;
}

// ── training/training-insight.schema.json ──
/**
 * Mirror of pain-flag.schema.json#/definitions/LocationCode — duplicated here so the Ollama grammar engine doesn't have to resolve cross-file $refs.
 */
export type LocationCode =
  | "back"
  | "shoulder"
  | "elbow"
  | "wrist"
  | "thumb"
  | "hip"
  | "knee"
  | "ankle"
  | "foot"
  | "neck"
  | "head"
  | "chest"
  | "abdominal"
  | "other";

/**
 * Per-period training insight emitted by the v3 training use-case. Three kinds: prescription (tomorrow's session), post_session (what just happened), weekly (week-over-week roll-up).
 */
export interface TrainingInsightV1 {
  schema_version: "training/insight/v1";
  /**
   * Auto-injected by the runner. true = artifact still in-flight or failed validation. Writer flips to false at atomic-rename time.
   */
  incomplete?: boolean;
  /**
   * Chain-of-thought trace produced before the answer fields.
   */
  reasoning_trace?: string | null;
  kind: "prescription" | "post_session" | "weekly";
  period_key: string;
  language: "de" | "en";
  abstain: boolean;
  abstain_reason?: string | null;
  headline?: string | null;
  summary?: string | null;
  /**
   * True when a cited set_log or pain_flag has been edited since emission; runner should re-emit.
   */
  stale?: boolean;
  prescription?: null | InsightPrescription;
  post_session?: null | PostSession;
  weekly?: null | WeeklyRollup;
  citations?: Citation[];
  confidence: {
    value: number;
    reasoning?: string | null;
  };
}
/**
 * When the parent insight abstains, all fields may be null/empty — the LLM is asked to set the whole `prescription` block to null in that case, but partial objects survive validation too.
 */
export interface InsightPrescription {
  suggested_session_template_id?: string | null;
  alternatives?: string[];
  justification_de?: string | null;
  load_adjustments?: {
    exercise_id: string;
    delta_kind: "increase" | "hold" | "decrease" | "substitute";
    delta_value?: string | null;
    reason_de?: string | null;
  }[];
}
/**
 * When the parent insight abstains, all fields may be null/empty.
 */
export interface PostSession {
  actual_session_id?: string | null;
  /**
   * @minItems 0
   * @maxItems 6
   */
  quality_kpis?:
    | []
    | [
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        }
      ]
    | [
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        }
      ]
    | [
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        }
      ]
    | [
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        }
      ]
    | [
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        }
      ]
    | [
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        },
        {
          id: string;
          label_de: string;
          value: number;
          band: "above_usual" | "steady" | "below_usual";
          reasoning?: string | null;
        }
      ];
  callouts_de?: string[];
  pain_quotes?: {
    pain_flag_id: number;
    /**
     * Verbatim echo of pain_flag.free_text or rendered template — never paraphrased.
     */
    verbatim_quote: string;
  }[];
}
export interface WeeklyRollup {
  sessions_completed?: number;
  sessions_planned?: number;
  adherence_pct?: number;
  /**
   * Sum of working sets per movement pattern.
   */
  volume_by_pattern?: {
    [k: string]: number | undefined;
  };
  rpe_trend?: {
    exercise_id: string;
    trend: "rising" | "flat" | "falling";
    samples?: number;
  }[];
  pain_recurrence?: {
    location_code: LocationCode;
    side: "left" | "right" | "bilateral" | "n_a";
    count_28d: number;
  }[];
  phase_progress?: {
    phase_id?: string;
    criteria_met?: number;
    criteria_total?: number;
    advance_suggested?: boolean;
  };
}
/**
 * Mirror of adjustment-proposal.schema.json#/definitions/Citation — duplicated to stay single-document for Ollama format mode.
 */
export interface Citation {
  kind:
    | "set_log"
    | "pain_flag"
    | "actual_session"
    | "recovery_metric"
    | "sleep_metric"
    | "activity_metric"
    | "workout"
    | "plan_version"
    | "resolution_note"
    | "other";
  ref_id: string;
  summary: string;
}

// ── training/training-plan.schema.json ──
/**
 * Generic training plan document. Holds arbitrary phases, each with arbitrary session templates referencing the exercise library. Independent of any single user's use case.
 */
export interface TrainingPlanV1 {
  schema_version: "training/plan/v1";
  name: string;
  status: "draft" | "active" | "archived";
  language?: "de" | "en";
  created_at: string;
  /**
   * @minItems 1
   */
  phases: [Phase, ...Phase[]];
  current_phase_id: string;
  cardio_guidance?: null | CardioGuidance;
  global_constraints?: string[];
  injury_protocol?: InjuryRule[];
  tracking_cadence?: null | TrackingCadence;
  todos?: string[];
  /**
   * Freeform narrative: detraining notes, injury history, goals. Read-only context for the LLM.
   */
  starting_position?: string | null;
  /**
   * High-level strategy across all phases. Read-only context.
   */
  strategy_overview?: string | null;
}
export interface Phase {
  id: string;
  label: string;
  label_long?: string | null;
  goal?: string | null;
  started_at?: string | null;
  planned_through?: string | null;
  intensity_guidance?: null | IntensityGuidance;
  progression_rule?: string | null;
  constraints?: string[];
  entry_criteria?: EntryCriterion[];
  session_templates: SessionTemplate[];
  schedule_hint?: null | ScheduleHint;
  character?: string | null;
}
export interface IntensityGuidance {
  rpe_floor?: number | null;
  rpe_ceiling?: number | null;
  rir_min?: number | null;
  note?: string | null;
}
export interface EntryCriterion {
  id: string;
  description: string;
  kind?: "duration" | "load" | "symptom_absence" | "metric" | "manual" | "other";
  param_json?: {
    [k: string]: unknown | undefined;
  };
}
export interface SessionTemplate {
  id: string;
  label: string;
  category?: "strength" | "conditioning" | "mobility" | "recovery" | "custom";
  estimated_duration_min?: number | null;
  warmup_text?: string | null;
  cooldown_text?: string | null;
  exercises: PrescribedExercise[];
}
export interface PrescribedExercise {
  exercise_id: string;
  order_idx: number;
  prescription: Prescription;
  notes?: string | null;
  warmup_only?: boolean;
}
export interface Prescription {
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  reps_per_side?: boolean;
  load_kg_min?: number | null;
  load_kg_max?: number | null;
  load_note?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  rpe_target?: number | null;
  rest_sec?: number | null;
}
export interface ScheduleHint {
  /**
   * @minItems 7
   * @maxItems 7
   */
  weekly_pattern?: [string, string, string, string, string, string, string];
  frequency_per_week?: number | null;
}
export interface CardioGuidance {
  frequency_per_week?: number | null;
  z2_minutes_target?: number | null;
  z3_allowed?: boolean;
  banned_modes?: string[];
  priority_modes?: string[];
  note?: string | null;
}
export interface InjuryRule {
  symptom: string;
  action: string;
  trigger_location_codes?: (
    | "back"
    | "shoulder"
    | "elbow"
    | "wrist"
    | "thumb"
    | "hip"
    | "knee"
    | "ankle"
    | "foot"
    | "neck"
    | "head"
    | "chest"
    | "abdominal"
    | "other"
  )[];
  severity?: "info" | "warn" | "critical";
}
export interface TrackingCadence {
  session_logging?: string | null;
  weekly_review_dow?: number;
  measurement_interval_weeks?: number | null;
}

// ════════ nutrition ════════

// ── nutrition/classify-output.schema.json ──
/**
 * Stage A — locked strict schema sent to Ollama as `format`. Same schema is re-validated client-side via parseAndValidate (pydantic-style). Minimal generation shape: no envelope fields. Storage envelope (meal_id, period_key, source, etc.) is bolted on by the runner after the model call. See docs/NUTRITION_VLM_VALIDATION.md §2.6.
 */
export interface NutritionClassifyOutput {
  meal_kind: "breakfast" | "lunch" | "dinner" | "snack" | "drink";
  /**
   * @minItems 1
   * @maxItems 20
   */
  components:
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ]
    | [
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        },
        {
          label: string;
          food_key: string;
          grams: number;
          confidence: number;
          rationale: string;
          source: "vlm" | "user_text";
        }
      ];
  notes: string;
}

// ── nutrition/day-aggregate-output.schema.json ──
/**
 * Stage C — locked strict schema for the multi-image day-aggregator LLM call. Generation shape: just `day_pattern.events[]` + `day_pattern.flags[]`. The runner wraps this with totals, delta_vs_target, period_key, meals_count, day_complete (all deterministically computable from the meal rows). See docs/NUTRITION_VLM_VALIDATION.md §4.1.
 */
export interface NutritionDayAggregateOutput {
  day_pattern: {
    /**
     * @minItems 0
     * @maxItems 10
     */
    events:
      | []
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ]
      | [
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          },
          {
            kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
            started_at: string;
            ended_at: string;
            /**
             * @minItems 1
             * @maxItems 20
             */
            meal_ids:
              | [string]
              | [string, string]
              | [string, string, string]
              | [string, string, string, string]
              | [string, string, string, string, string]
              | [string, string, string, string, string, string]
              | [string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string]
              | [string, string, string, string, string, string, string, string, string, string, string, string, string]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ]
              | [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string
                ];
            summary: string;
          }
        ];
    /**
     * @maxItems 20
     */
    flags:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string
        ];
  };
}

// ── nutrition/day-pattern.schema.json ──
/**
 * v3 nutrition cluster output. Aggregates one day's meals into totals + delta-vs-target + qualitative `events[]` produced by a multi-image VLM pass over all the day's photos in chronological order. Persisted to PULSE_INSIGHT with cluster='nutrition'.
 */
export interface NutritionDayPatternV1 {
  schema_version: "nutrition/day-pattern/v1";
  period_key: string;
  language: "de" | "en";
  meals_count: number;
  day_complete: boolean;
  totals: NutritionFacts;
  /**
   * Signed deltas (intake - target). Only nutrients with a configured target appear.
   */
  delta_vs_target: {
    [k: string]: number | undefined;
  };
  events: DayPatternEvent[];
  /**
   * Pattern flags emitted by the VLM, e.g. 'possible_unlogged_evening', 'protein_gap_training_day'.
   */
  flags: string[];
  reasoning_trace?: string | null;
}
export interface NutritionFacts {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sugar_g?: number;
  saturated_fat_g?: number;
  sodium_mg?: number;
  iron_mg?: number;
  calcium_mg?: number;
  magnesium_mg?: number;
  zinc_mg?: number;
  vit_c_mg?: number;
  vit_d_ug?: number;
  vit_b12_ug?: number;
  folate_ug?: number;
  omega3_g?: number;
}
export interface DayPatternEvent {
  kind: "single_meal" | "multi_course" | "snacking" | "drink_round";
  started_at: string;
  ended_at: string;
  /**
   * @minItems 1
   */
  meal_ids: [string, ...string[]];
  summary: string;
}

// ── nutrition/enrich-output.schema.json ──
/**
 * Stage B — locked strict schema for the per-100g nutrition lookup LLM call. All 10 nutrient fields required (no optional micros at generation time — the model must produce a value, even 0). Runner wraps this with cache envelope (source='llm', model, captured_at) before persisting. See docs/NUTRITION_VLM_VALIDATION.md §3.1.
 */
export interface NutritionEnrichOutput {
  food_key: string;
  label_de: string;
  per_100g: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    iron_mg: number;
    vit_c_mg: number;
    vit_b12_ug: number;
    calcium_mg: number;
    magnesium_mg: number;
  };
  notes: string;
}

// ── nutrition/meal.schema.json ──
/**
 * A single meal record — one photo (optional) + optional user_text + classification + nutrition snapshot. Source of truth for the /api/ingest/meal payload, the pulse.db PULSE_MEAL row's read shape, and the records/<id>.json snapshot.
 */
export interface MealV1 {
  schema_version: "nutrition/meal/v1";
  id: string;
  user_meal_at: string;
  period_key: string;
  photo_path?: string | null;
  photo_mime?: string | null;
  user_text?: string | null;
  notes?: string | null;
  status: "pending" | "classified" | "edited" | "failed";
  source: "photo" | "photo+text" | "text" | "manual";
  kind: "breakfast" | "lunch" | "dinner" | "snack" | "drink";
  classified_at?: string | null;
  edited_at?: string | null;
  components: MealComponent[];
  revisions: MealRevision[];
  totals: NutritionFacts;
}
export interface MealComponent {
  id: string;
  ord: number;
  food_key: string;
  label: string;
  grams: number;
  confidence?: number | null;
  source: "vlm" | "user_edit" | "user_add" | "user_text";
  nutrition: NutritionSnapshot;
}
export interface NutritionSnapshot {
  per100g: NutritionFacts;
  totals: NutritionFacts;
}
export interface NutritionFacts {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sugar_g?: number;
  saturated_fat_g?: number;
  sodium_mg?: number;
  iron_mg?: number;
  calcium_mg?: number;
  magnesium_mg?: number;
  zinc_mg?: number;
  vit_c_mg?: number;
  vit_d_ug?: number;
  vit_b12_ug?: number;
  folate_ug?: number;
  omega3_g?: number;
}
export interface MealRevision {
  id: string;
  created_at: string;
  diff_summary: string;
  by: "user" | "vlm";
}

// ── nutrition/nutrition-targets.schema.json ──
/**
 * User-configurable per-nutrient targets. Persisted at $PULSE_ROOT/meals/targets.json (and shadowed in PULSE_STATE_KV key='nutrition_targets'). Either `target` (literal) or `auto_from` (formula evaluated server-side, e.g. '1.6 * weight_kg') must be set; UI shows whichever is non-null.
 */
export interface NutritionTargetsV1 {
  schema_version: "nutrition/targets/v1";
  updated_at: string;
  rows: NutrientTarget[];
}
export interface NutrientTarget {
  key: string;
  label: string;
  unit: "kcal" | "g" | "mg" | "ug";
  group: "macro" | "micro";
  target?: number | null;
  auto_from?: string | null;
  default_target: number | null;
}
