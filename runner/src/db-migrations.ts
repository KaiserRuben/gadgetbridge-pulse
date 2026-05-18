/**
 * Phase 4 write-back migrations.
 *
 * Applied to `pulse.db`, NOT Gadgetbridge.db. The latter is replaced wholesale
 * by Syncthing on every Android Gadgetbridge export, so any tables we put
 * there get wiped. `pulse.db` is the Pulse-owned sidecar that survives.
 *
 * The migrations themselves (M001-M005) define the namespaced PULSE_* tables.
 * Gadgetbridge owns its own schema (USER, HUAWEI_ACTIVITY_SAMPLE, ...) and we
 * never touch it.
 *
 * Migrations are recorded in PULSE_MIGRATIONS keyed by string id and applied
 * exactly once per id. Re-running runMigrations() is a no-op when up-to-date.
 *
 * The function is sync — better-sqlite3 is a sync API and the call site
 * (writable-db init, CLI script) needs sync semantics.
 */

import Database from "better-sqlite3";

import { config } from "./config.ts";

interface Migration {
  id: string;
  /**
   * SQL to apply. Multiple statements are fine — we wrap the whole thing
   * plus the PULSE_MIGRATIONS insert in a single transaction.
   */
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: "M001_manual_log",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_MANUAL_LOG (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_iso TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        source TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_manual_log_metric_ts
        ON PULSE_MANUAL_LOG(metric, ts_iso DESC);
    `,
  },
  {
    id: "M002_journal_entry",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_JOURNAL_ENTRY (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_iso TEXT NOT NULL,
        text TEXT,
        mood INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_journal_ts
        ON PULSE_JOURNAL_ENTRY(ts_iso DESC);
    `,
  },
  {
    id: "M003_pattern_library",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_PATTERN_LIBRARY (
        id TEXT PRIMARY KEY,
        name_de TEXT NOT NULL,
        description_de TEXT,
        signature_json TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        user_confirmed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_pattern_last_seen
        ON PULSE_PATTERN_LIBRARY(last_seen DESC);
    `,
  },
  {
    id: "M004_feel_log",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_FEEL_LOG (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_iso TEXT NOT NULL,
        feel INTEGER NOT NULL,
        note TEXT,
        source TEXT NOT NULL DEFAULT 'user_input',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_feel_ts
        ON PULSE_FEEL_LOG(ts_iso DESC);
    `,
  },
  {
    id: "M005_user_attributes",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_USER_ATTRIBUTES (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_iso TEXT NOT NULL,
        height_cm REAL,
        steps_goal_spd INTEGER,
        sleep_goal_mpd INTEGER,
        source TEXT NOT NULL DEFAULT 'user_input',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_user_attrs_ts
        ON PULSE_USER_ATTRIBUTES(ts_iso DESC);
    `,
  },
  {
    id: "M006_push_subscription",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_PUSH_SUBSCRIPTION (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_push_subscription_last_seen
        ON PULSE_PUSH_SUBSCRIPTION(last_seen_at DESC);
    `,
  },
  {
    id: "M007_period_store",
    sql: `
      CREATE TABLE IF NOT EXISTS PULSE_FACTS (
        period_key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'daily',
        status TEXT NOT NULL DEFAULT 'live',
        payload_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'runner',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (period_key, scope)
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_facts_updated
        ON PULSE_FACTS(updated_at DESC);

      CREATE TABLE IF NOT EXISTS PULSE_INSIGHT (
        period_key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'daily',
        cluster TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'runner',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (period_key, scope, cluster)
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_insight_updated
        ON PULSE_INSIGHT(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pulse_insight_period
        ON PULSE_INSIGHT(period_key, scope);

      CREATE TABLE IF NOT EXISTS PULSE_BUNDLE (
        period_key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'daily',
        status TEXT NOT NULL DEFAULT 'pending',
        pipeline TEXT NOT NULL DEFAULT 'v2',
        stages_json TEXT NOT NULL DEFAULT '[]',
        verify_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (period_key, scope, pipeline)
      );

      CREATE TABLE IF NOT EXISTS PULSE_STATE_KV (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS PULSE_ALARM_EVENT (
        id TEXT PRIMARY KEY,
        period_key TEXT NOT NULL,
        ts_iso TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        dismissed_at TEXT,
        snooze_until TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_alarm_period
        ON PULSE_ALARM_EVENT(period_key, ts_iso DESC);

      CREATE TABLE IF NOT EXISTS PULSE_EVENT_LOG (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        period_key TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_event_period
        ON PULSE_EVENT_LOG(period_key, ts_ms DESC);

      CREATE TABLE IF NOT EXISTS PULSE_INGEST_LOG (
        idempotency_key TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        period_key TEXT,
        accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `,
  },
  {
    id: "M008_training",
    sql: `
      -- ── Plan versions ────────────────────────────────────────────────────
      -- Full plan document stored in payload_json. Diffing two versions =
      -- JSON diff on this column. parent_version + change_summary mandatory
      -- after v1 so future LLM analysis always has the *reason*, not just
      -- the *delta*. Single-active enforced by partial unique index.
      CREATE TABLE IF NOT EXISTS PULSE_TRAINING_PLAN (
        version INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        created_by TEXT NOT NULL CHECK (created_by IN ('seed','user','proposal')),
        parent_version INTEGER REFERENCES PULSE_TRAINING_PLAN(version),
        accepted_proposal_id INTEGER,
        change_summary TEXT,
        is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_training_plan_active
        ON PULSE_TRAINING_PLAN(is_active) WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS idx_pulse_training_plan_created
        ON PULSE_TRAINING_PLAN(created_at DESC);

      -- ── Exercise library ────────────────────────────────────────────────
      -- Stable id, first-class so plans + set logs reference by string id
      -- instead of carrying full exercise definitions in their payloads.
      CREATE TABLE IF NOT EXISTS PULSE_EXERCISE (
        id TEXT PRIMARY KEY,
        display_de TEXT NOT NULL,
        display_en TEXT,
        movement_pattern TEXT NOT NULL,
        primary_muscles_json TEXT NOT NULL DEFAULT '[]',
        equipment_json TEXT NOT NULL DEFAULT '[]',
        substitutes_json TEXT NOT NULL DEFAULT '[]',
        contraindications_json TEXT NOT NULL DEFAULT '[]',
        unilateral INTEGER NOT NULL DEFAULT 0 CHECK (unilateral IN (0,1)),
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes_de TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_exercise_pattern
        ON PULSE_EXERCISE(movement_pattern);

      -- ── Planned sessions (materialised lazily) ──────────────────────────
      -- One row per (period_key, plan_version, session_template_id).
      -- Target prescription frozen at materialisation time so mid-week plan
      -- bumps don't silently shift today's numbers.
      CREATE TABLE IF NOT EXISTS PULSE_PLANNED_SESSION (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_key TEXT NOT NULL,
        plan_version INTEGER NOT NULL REFERENCES PULSE_TRAINING_PLAN(version),
        session_template_id TEXT NOT NULL,
        target_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_planned_session_key
        ON PULSE_PLANNED_SESSION(period_key, plan_version, session_template_id);
      CREATE INDEX IF NOT EXISTS idx_pulse_planned_session_period
        ON PULSE_PLANNED_SESSION(period_key);

      -- ── Actual sessions ─────────────────────────────────────────────────
      -- UUID PK so the browser can mint an id locally and write idempotently
      -- once it reaches the Pi. period_key is wake-date-local per period.ts
      -- helpers so day-bound queries align with the rest of Pulse.
      CREATE TABLE IF NOT EXISTS PULSE_ACTUAL_SESSION (
        id TEXT PRIMARY KEY,
        period_key TEXT NOT NULL,
        plan_version INTEGER NOT NULL REFERENCES PULSE_TRAINING_PLAN(version),
        planned_session_id INTEGER REFERENCES PULSE_PLANNED_SESSION(id),
        session_template_id TEXT,
        deviation_reason TEXT CHECK (deviation_reason IN ('user_choice','recovery','schedule','other')),
        state TEXT NOT NULL CHECK (state IN ('in_progress','completed','abandoned')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        subjective_energy INTEGER CHECK (subjective_energy BETWEEN 1 AND 5),
        note TEXT,
        wearable_workout_id INTEGER,
        wearable_link_status TEXT NOT NULL DEFAULT 'none'
          CHECK (wearable_link_status IN ('none','tentative','confirmed','manual')),
        wearable_link_resolved_at TEXT,
        last_edited_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_actual_session_period
        ON PULSE_ACTUAL_SESSION(period_key);
      CREATE INDEX IF NOT EXISTS idx_pulse_actual_session_state
        ON PULSE_ACTUAL_SESSION(state, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pulse_actual_session_wearable
        ON PULSE_ACTUAL_SESSION(wearable_workout_id) WHERE wearable_workout_id IS NOT NULL;

      -- ── Set logs ────────────────────────────────────────────────────────
      -- Generic shape: reps + weight for strength, duration + distance for
      -- conditioning, both nullable for BW holds. RPE 1-10, RIR 0-10 (used
      -- by some lifters), side optional (unilateral exercises).
      CREATE TABLE IF NOT EXISTS PULSE_SET_LOG (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actual_session_id TEXT NOT NULL REFERENCES PULSE_ACTUAL_SESSION(id) ON DELETE CASCADE,
        exercise_id TEXT NOT NULL REFERENCES PULSE_EXERCISE(id),
        set_idx INTEGER NOT NULL CHECK (set_idx BETWEEN 1 AND 99),
        reps INTEGER,
        weight_kg REAL,
        duration_sec REAL,
        distance_m REAL,
        rpe REAL CHECK (rpe IS NULL OR (rpe BETWEEN 1 AND 10)),
        rir REAL CHECK (rir IS NULL OR (rir BETWEEN 0 AND 10)),
        side TEXT CHECK (side IS NULL OR side IN ('both','left','right')),
        note TEXT,
        logged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_edited_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_set_log_session
        ON PULSE_SET_LOG(actual_session_id, set_idx);
      CREATE INDEX IF NOT EXISTS idx_pulse_set_log_exercise
        ON PULSE_SET_LOG(exercise_id, logged_at DESC);

      -- ── Set-log audit ────────────────────────────────────────────────────
      -- Q6 resolution: edits allowed, audit row preserves before/after so
      -- the original numbers are recoverable. Source distinguishes edit
      -- vs delete vs system corrections.
      CREATE TABLE IF NOT EXISTS PULSE_SET_LOG_AUDIT (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        set_log_id INTEGER NOT NULL,
        edited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        before_json TEXT NOT NULL,
        after_json TEXT,
        source TEXT NOT NULL CHECK (source IN ('user_edit','delete','system'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_set_log_audit_log
        ON PULSE_SET_LOG_AUDIT(set_log_id, edited_at DESC);

      -- ── Pain flags ──────────────────────────────────────────────────────
      -- Closed enum on location_code + side for aggregation. free_text is
      -- verbatim user input — never paraphrased, never grouped on.
      CREATE TABLE IF NOT EXISTS PULSE_PAIN_FLAG (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actual_session_id TEXT NOT NULL REFERENCES PULSE_ACTUAL_SESSION(id) ON DELETE CASCADE,
        exercise_id TEXT REFERENCES PULSE_EXERCISE(id),
        set_log_id INTEGER REFERENCES PULSE_SET_LOG(id) ON DELETE SET NULL,
        location_code TEXT NOT NULL CHECK (location_code IN (
          'back','shoulder','elbow','wrist','thumb','hip','knee','ankle','foot',
          'neck','head','chest','abdominal','other'
        )),
        side TEXT NOT NULL CHECK (side IN ('left','right','bilateral','n_a')),
        severity TEXT NOT NULL CHECK (severity IN ('mild','sharp')),
        free_text TEXT,
        raised_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_pain_location
        ON PULSE_PAIN_FLAG(location_code, side, raised_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pulse_pain_session
        ON PULSE_PAIN_FLAG(actual_session_id);

      -- ── Adjustment proposals ────────────────────────────────────────────
      -- LLM-generated diff against the active plan. Status transitions:
      --   pending → (accepted | rejected | edited)
      -- Accepted proposals produce a new PULSE_TRAINING_PLAN row via app
      -- logic; this table is the audit trail of what was proposed, why,
      -- and how the user responded.
      CREATE TABLE IF NOT EXISTS PULSE_ADJUSTMENT_PROPOSAL (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        model TEXT,
        prompt_version TEXT,
        target_plan_version INTEGER NOT NULL REFERENCES PULSE_TRAINING_PLAN(version),
        scope TEXT NOT NULL CHECK (scope IN ('exercise','session_template','phase','global')),
        diff_json TEXT NOT NULL,
        reasoning_trace TEXT NOT NULL,
        summary_de TEXT,
        cited_data_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','accepted','rejected','edited')),
        resolved_at TEXT,
        resolution_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_adj_status
        ON PULSE_ADJUSTMENT_PROPOSAL(status, generated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pulse_adj_target
        ON PULSE_ADJUSTMENT_PROPOSAL(target_plan_version);

      -- ── Chat threads + messages ─────────────────────────────────────────
      -- Backs the J7 "Frag Pulse" surface. Messages queue when the remote
      -- Ollama endpoint is unreachable; a Pi-side worker drains the queue
      -- once reachability returns. context_snapshot_json is the frozen plan
      -- + recent-session bundle attached to the user question at send time
      -- so the assistant reply uses the state-at-send, not later state.
      CREATE TABLE IF NOT EXISTS PULSE_CHAT_THREAD (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        title TEXT,
        last_message_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_chat_thread_recent
        ON PULSE_CHAT_THREAD(last_message_at DESC);

      CREATE TABLE IF NOT EXISTS PULSE_CHAT_MESSAGE (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL REFERENCES PULSE_CHAT_THREAD(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        delivered_at TEXT,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued','in_flight','delivered','failed','cancelled')),
        content TEXT,
        context_snapshot_json TEXT,
        model TEXT,
        endpoint TEXT CHECK (endpoint IS NULL OR endpoint IN ('remote','local')),
        extracted_proposal_id INTEGER REFERENCES PULSE_ADJUSTMENT_PROPOSAL(id),
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_chat_message_thread
        ON PULSE_CHAT_MESSAGE(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pulse_chat_message_queue
        ON PULSE_CHAT_MESSAGE(status, created_at)
        WHERE status IN ('queued','in_flight');
    `,
  },
  {
    id: "M009_nutrition",
    sql: `
      -- ── Meals ───────────────────────────────────────────────────────────
      -- One row per logged meal. photo_path is relative to
      -- $PULSE_ROOT/meals/photos. Either photo_path or user_text must be
      -- non-null (enforced by app layer, not CHECK, so manual rows stay
      -- flexible). period_key is wake-date-local per period.ts.
      CREATE TABLE IF NOT EXISTS PULSE_MEAL (
        id TEXT PRIMARY KEY,
        user_meal_at TEXT NOT NULL,
        period_key TEXT NOT NULL,
        photo_path TEXT,
        photo_mime TEXT,
        user_text TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','classified','edited','failed')),
        source TEXT NOT NULL
          CHECK (source IN ('photo','photo+text','text','manual')),
        kind TEXT NOT NULL DEFAULT 'snack'
          CHECK (kind IN ('breakfast','lunch','dinner','snack','drink')),
        classified_at TEXT,
        edited_at TEXT,
        totals_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_period
        ON PULSE_MEAL(period_key, user_meal_at);
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_time
        ON PULSE_MEAL(user_meal_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_status
        ON PULSE_MEAL(status) WHERE status IN ('pending','failed');

      -- ── Meal components ─────────────────────────────────────────────────
      -- Each component carries its own per-100g + totals snapshot in
      -- nutrition_json so later changes to PULSE_FOOD_NUTRITION never
      -- retroactively rewrite a logged meal. source distinguishes VLM
      -- output from user edits / additions / text-hinted values.
      CREATE TABLE IF NOT EXISTS PULSE_MEAL_COMPONENT (
        id TEXT PRIMARY KEY,
        meal_id TEXT NOT NULL REFERENCES PULSE_MEAL(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        food_key TEXT NOT NULL,
        label TEXT NOT NULL,
        grams REAL NOT NULL CHECK (grams >= 0),
        confidence REAL CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
        source TEXT NOT NULL
          CHECK (source IN ('vlm','user_edit','user_add','user_text')),
        nutrition_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_component_meal
        ON PULSE_MEAL_COMPONENT(meal_id, ord);
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_component_food
        ON PULSE_MEAL_COMPONENT(food_key);

      -- ── Meal revisions ──────────────────────────────────────────────────
      -- Edit history. Each row is a diff_summary string (UI-facing) plus the
      -- raw before/after component snapshot in diff_json. User edits never
      -- delete prior rows — revisions are append-only.
      CREATE TABLE IF NOT EXISTS PULSE_MEAL_REVISION (
        id TEXT PRIMARY KEY,
        meal_id TEXT NOT NULL REFERENCES PULSE_MEAL(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        diff_summary TEXT NOT NULL,
        diff_json TEXT NOT NULL,
        by TEXT NOT NULL CHECK (by IN ('user','vlm'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_revision_meal
        ON PULSE_MEAL_REVISION(meal_id, created_at DESC);

      -- ── Food nutrition cache ────────────────────────────────────────────
      -- Stage B output, per food_key. source='seed' rows come from the
      -- static USDA-derived table (loaded at startup, not via INSERT here).
      -- source='llm' rows are LLM-derived and stable (no auto-invalidation,
      -- manual clear from UI). per_100g_json shape matches NutritionFacts.
      CREATE TABLE IF NOT EXISTS PULSE_FOOD_NUTRITION (
        food_key TEXT PRIMARY KEY,
        label TEXT,
        source TEXT NOT NULL CHECK (source IN ('seed','llm')),
        model TEXT,
        per_100g_json TEXT NOT NULL,
        captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `,
  },
  {
    id: "M010_meal_photos",
    sql: `
      -- ── Multi-photo per meal ────────────────────────────────────────────
      -- A meal can carry multiple photos: the plate, the packaging /
      -- nutrition label, additional angles, the receipt. The first photo
      -- (ord=0) is also mirrored into PULSE_MEAL.photo_path so list views
      -- can pick a cover without joining. The VLM classifier consumes all
      -- photos in one vision call.
      --
      -- 'kind' is a hint for the classifier (and for the UI): "meal" for the
      -- food itself, "label" for nutrition packaging, "context" for plate
      -- angles / receipts. The classifier may also infer it from content.
      CREATE TABLE IF NOT EXISTS PULSE_MEAL_PHOTO (
        id TEXT PRIMARY KEY,
        meal_id TEXT NOT NULL REFERENCES PULSE_MEAL(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        path TEXT NOT NULL,
        mime TEXT,
        kind TEXT CHECK (kind IS NULL OR kind IN ('meal','label','context')),
        captured_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_photo_meal
        ON PULSE_MEAL_PHOTO(meal_id, ord);

      -- Backfill: every existing PULSE_MEAL row with a non-null photo_path
      -- gets a corresponding ord=0 row. Idempotent — re-running selects no
      -- new rows because the WHERE NOT EXISTS clause excludes meals that
      -- already have at least one photo recorded.
      INSERT INTO PULSE_MEAL_PHOTO (id, meal_id, ord, path, mime, kind, captured_at)
      SELECT
        m.id || '-p0' AS id,
        m.id          AS meal_id,
        0             AS ord,
        m.photo_path  AS path,
        m.photo_mime  AS mime,
        'meal'        AS kind,
        m.user_meal_at AS captured_at
      FROM PULSE_MEAL m
      WHERE m.photo_path IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM PULSE_MEAL_PHOTO p WHERE p.meal_id = m.id
        );
    `,
  },
  {
    id: "M011_meal_lease",
    sql: `
      -- ── Meal classify queue ─────────────────────────────────────────────
      -- Adds two columns to PULSE_MEAL so the row itself can act as the
      -- work queue without needing an extra status value:
      --   leased_at      — when set, a runner currently owns this meal
      --                    (status='pending' AND leased_at IS NOT NULL is
      --                    the "processing" state). NULL = available.
      --   error_reason   — terminal failure text surfaced on status='failed'.
      --
      -- ADD COLUMN is non-destructive: no table rebuild, so the existing
      -- ON DELETE CASCADE FKs from PULSE_MEAL_COMPONENT / _PHOTO / _REVISION
      -- never fire. An earlier draft of this migration rebuilt the table
      -- and cascade-deleted every child row — don't go back to that shape.
      ALTER TABLE PULSE_MEAL ADD COLUMN leased_at TEXT;
      ALTER TABLE PULSE_MEAL ADD COLUMN error_reason TEXT;

      -- Queue index: cheap scan for oldest available meals + the stale-lease
      -- sweep. Partial-index predicate matches the runner's read filter so
      -- the index covers the hot path exactly.
      CREATE INDEX IF NOT EXISTS idx_pulse_meal_queue
        ON PULSE_MEAL(user_meal_at)
        WHERE status = 'pending';
    `,
  },
  {
    id: "M012_insight_jobcell",
    sql: `
      -- ── JobCell columns on PULSE_INSIGHT ────────────────────────────────
      -- Turns each (period_key, scope, cluster) row into a self-describing
      -- job cell. Lease semantics mirror PULSE_MEAL (M011): leased_at NULL
      -- means available; non-null means a runner currently owns the row.
      -- started_at is the first-claim timestamp (for "reprocessing" UI);
      -- retries counts stale-lease sweeps so we can cap them at MAX_RETRIES.
      ALTER TABLE PULSE_INSIGHT ADD COLUMN started_at TEXT;
      ALTER TABLE PULSE_INSIGHT ADD COLUMN leased_at TEXT;
      ALTER TABLE PULSE_INSIGHT ADD COLUMN error_text TEXT;
      ALTER TABLE PULSE_INSIGHT ADD COLUMN retries INTEGER NOT NULL DEFAULT 0;

      -- Backfill: rows that already have a payload (live/complete/partial)
      -- get a started_at so the "never_computed" → "ready_*" mapping in
      -- app/api/jobs/[cluster]/[key]/route.ts doesn't show them as fresh.
      UPDATE PULSE_INSIGHT
        SET started_at = updated_at
        WHERE status IN ('live','complete','partial');

      -- Lease-sweep index. WHERE leased_at IS NOT NULL keeps it tiny — the
      -- in-flight set is usually a handful of rows across all clusters.
      CREATE INDEX IF NOT EXISTS idx_insight_lease
        ON PULSE_INSIGHT(leased_at, status)
        WHERE leased_at IS NOT NULL;

      -- Pending dispatch index. Covers the queue scan: "next available
      -- cluster cell, oldest first, that still has retries left".
      CREATE INDEX IF NOT EXISTS idx_insight_pending
        ON PULSE_INSIGHT(status, retries, updated_at)
        WHERE status = 'pending';
    `,
  },
  {
    id: "M013_food_nutrition_en_query",
    sql: `
      -- ── External-source grounding for per-100g lookup ───────────────────
      -- Stage B grounding cascade adds USDA FoodData Central + Open Food
      -- Facts as authoritative sources. en_query is the translated USDA
      -- search term so we don't pay the ministral translation cost twice
      -- for the same German food_key. Nullable: pre-existing 'seed' rows
      -- never need it; 'usda' rows fill it on insert.
      --
      -- The CHECK constraint on PULSE_FOOD_NUTRITION.source was an enum of
      -- ('seed','llm'). We widen it to also accept 'usda', 'off', 'user'.
      -- SQLite can't ALTER a CHECK so we rebuild the table preserving rows.
      ALTER TABLE PULSE_FOOD_NUTRITION ADD COLUMN en_query TEXT;

      CREATE TABLE PULSE_FOOD_NUTRITION_NEW (
        food_key TEXT PRIMARY KEY,
        label TEXT,
        source TEXT NOT NULL CHECK (source IN ('seed','llm','usda','off','user')),
        model TEXT,
        per_100g_json TEXT NOT NULL,
        captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        en_query TEXT
      );
      INSERT INTO PULSE_FOOD_NUTRITION_NEW
        (food_key, label, source, model, per_100g_json, captured_at, en_query)
        SELECT food_key, label, source, model, per_100g_json, captured_at, en_query
          FROM PULSE_FOOD_NUTRITION;
      DROP TABLE PULSE_FOOD_NUTRITION;
      ALTER TABLE PULSE_FOOD_NUTRITION_NEW RENAME TO PULSE_FOOD_NUTRITION;
    `,
  },
  {
    id: "M014_meal_component_provenance",
    sql: `
      -- ── Provenance per meal component ───────────────────────────────────
      -- Phase 2b grounding pipeline tags each component with the source(s)
      -- of its identity + nutrition values. Schema mirrors ProvenanceTag[]
      -- from runner/src/jobs/types.ts. Nullable so pre-existing rows stay
      -- intact; renderers fall back to component.source when absent.
      ALTER TABLE PULSE_MEAL_COMPONENT ADD COLUMN provenance_json TEXT;
    `,
  },
];

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS PULSE_MIGRATIONS (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function isApplied(db: Database.Database, id: string): boolean {
  const row = db
    .prepare<[string], { id: string }>(
      `SELECT id FROM PULSE_MIGRATIONS WHERE id = ?`,
    )
    .get(id);
  return Boolean(row);
}

/**
 * Run any pending migrations. Idempotent: re-running is a no-op once all
 * MIGRATIONS entries are recorded.
 *
 * If `db` is omitted, opens a fresh writable connection from
 * `config.pulseDbPath`, runs migrations, and closes it. The CLI uses that
 * path; `getWritableDb()` passes its own handle so the connection persists.
 *
 * `fileMustExist: false` — pulse.db is auto-created on first open. This is
 * intentional: pulse.db is OUR file, unlike Gadgetbridge.db which we expect
 * to receive from the phone.
 */
export function runMigrations(db?: Database.Database): { applied: string[]; total: number } {
  const owned = !db;
  const conn = db ?? new Database(config.pulseDbPath, { readonly: false });
  try {
    if (owned) {
      conn.pragma("journal_mode = WAL");
      conn.pragma("busy_timeout = 5000");
      conn.pragma("foreign_keys = ON");
    }
    ensureMigrationsTable(conn);

    const applied: string[] = [];
    const insert = conn.prepare(
      `INSERT INTO PULSE_MIGRATIONS (id, applied_at) VALUES (?, ?)`,
    );
    for (const m of MIGRATIONS) {
      if (isApplied(conn, m.id)) continue;
      const tx = conn.transaction(() => {
        conn.exec(m.sql);
        insert.run(m.id, new Date().toISOString());
      });
      tx();
      applied.push(m.id);
    }
    return { applied, total: MIGRATIONS.length };
  } finally {
    if (owned) conn.close();
  }
}

/** All known migration ids — useful for the CLI to print status. */
export function listMigrationIds(): string[] {
  return MIGRATIONS.map((m) => m.id);
}
