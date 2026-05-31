/** Central runner config. Override via env. */

import path from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

/** Data namespace inside the Syncthing share. Override with PULSE_ROOT. */
const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";

/**
 * Skip the existsSync guard during Next.js build. Build-time route collection
 * imports this module on the Pi where the Mac's Syncthing path doesn't exist,
 * and runtime env vars haven't been wired into the build sandbox.
 *
 * Set NEXT_BUILD=1 (or rely on NEXT_PHASE=phase-production-build, which Next
 * sets automatically during `next build`) to bypass the runtime DB check.
 */
const IS_NEXT_BUILD =
  process.env.NEXT_BUILD === "1" ||
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export";

const insightsRoot = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

export const config = {
  /** Source-of-truth DB. Read-only, replaced by Android Gadgetbridge exports. */
  dbPath: process.env.GADGETBRIDGE_DB_PATH ?? path.join(SYNC_ROOT, "Gadgetbridge.db"),

  /**
   * Pulse-owned sidecar DB. Holds all PULSE_* tables (manual log, journal,
   * feel, pattern library, user attribute overrides, migrations). Persistent
   * across Gadgetbridge re-exports — Syncthing replaces Gadgetbridge.db
   * wholesale, so we must NOT colocate our writes there.
   */
  pulseDbPath: process.env.PULSE_DB_PATH ?? path.join(SYNC_ROOT, "pulse.db"),

  /** Where insights land. Synced to Pi. */
  insightsRoot,

  /** State files (pause.json, labs.json, alarm_state.json). Bidirectional sync. */
  stateRoot: process.env.STATE_ROOT ?? path.join(SYNC_ROOT, "state"),

  /** Alarm event log directory (under insightsRoot). */
  alarmsRoot: process.env.ALARMS_ROOT ?? path.join(insightsRoot, "alarms"),

  /**
   * Nutrition meal tree. inbox/ accepts user uploads (written by Pi via the
   * `/api/nutrition/upload` route, synced to Mac via Syncthing). photos/ is
   * the archived classified set (Mac moves files from inbox here once Stage A
   * completes). records/ holds per-meal JSON snapshots (mirror of pulse.db
   * for the dashboard read path).
   */
  mealsRoot: process.env.PULSE_MEALS_ROOT ?? path.join(SYNC_ROOT, "meals"),

  /** Ollama endpoint. */
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",

  /** Single model (v2 lock). qwen3.6 in production. */
  model: process.env.COACH_MODEL ?? "qwen3.6:latest",

  /**
   * Stage A agentic tool-loop kill switch (env: `NUTRITION_TOOLS_ENABLED`).
   * Accepts "1"/"true"/"yes" to enable. When on, the classify VLM call
   * is allowed to invoke the `search_nutrition` tool (max 5 calls/meal)
   * to disambiguate food_keys against the seed / cache / USDA / OFF
   * cascade before committing. Default off pending 4-photo A/B
   * validation per `docs/wip/NUTRITION_TOOL_CALLING.md`.
   *
   * Note: `nutrition/stages/classify-vlm.ts` re-reads `process.env` at
   * call time (not this snapshot) so the flag can be flipped per-run for
   * the grounding probe without restarting the runner. This snapshot is
   * informational / for log output only.
   */
  nutritionToolsEnabled: (() => {
    const v = (process.env.NUTRITION_TOOLS_ENABLED ?? "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  })(),

  /** Local timezone for wake-date computation. */
  timezone: "Europe/Berlin",

  /** Confidence-math tolerance: |reported - Σ(w·s)| ≤ this triggers retry. */
  confidenceTolerance: 0.10,

  /** Per-prompt retry budget. */
  maxAttempts: 3,

  /**
   * Pi dashboard ingest base URL. Mac runner POSTs facts/insights/bundle
   * here over Tailscale; the Pi writes them into pulse.db. Empty → ingest
   * disabled (runner stays in legacy file-write mode).
   */
  ingestBaseUrl: process.env.PULSE_INGEST_BASE_URL ?? "",

  /** Shared Bearer secret for /api/ingest/*. Must match dashboard INGEST_TOKEN. */
  ingestToken: process.env.PULSE_INGEST_TOKEN ?? "",

  /**
   * Outbox SQLite path. Queues ingest POSTs that fail (Pi unreachable,
   * Tailscale flap, transient 5xx) and replays them in background. Survives
   * runner restarts. Default lives outside Syncthing on purpose.
   *
   * Docker compose pins this to `/data/ingest-outbox.db` (mounted volume).
   * For local dev or systemd installs without an explicit override, fall
   * back to `~/.pulse/ingest-outbox.db` so the runner doesn't need root.
   */
  // Outbox is mac-runner-local state, NEVER in $PULSE_ROOT (Syncthing folder).
  // Docker compose binds `/runner-state` to a named volume; local dev /
  // systemd installs fall back to `~/.pulse/`.
  ingestOutboxPath:
    process.env.PULSE_INGEST_OUTBOX_PATH ??
    (existsSync("/runner-state")
      ? "/runner-state/ingest-outbox.db"
      : path.join(homedir(), ".pulse", "ingest-outbox.db")),

  /**
   * Hard wall-clock cap applied to every Ollama HTTP call. Generation is
   * bounded by num_predict + schema grammar; this timeout is the outer
   * safety net for stuck connections / hung backends. Previously 45 min,
   * which let a single wedged call eat ~7 h across 3-attempt retry loops
   * (see 2026-05-21 v3:activity logs). 15 min is generous for qwen3.6 +
   * 32k num_predict (~38 min at 14 tok/s) but the heartbeat line at 30 s
   * cadence catches truly hung calls long before the cap fires.
   *
   * Override per-deployment via `OLLAMA_TIMEOUT_MS` env (e.g. 900000 for
   * 15 min, 600000 for 10 min on a faster GPU).
   */
  llmTimeoutMs: (() => {
    const env = process.env.OLLAMA_TIMEOUT_MS?.trim();
    const parsed = env ? Number(env) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000;
  })(),

  /** Generation options shared across all prompts. */
  ollamaOptions: {
    temperature: 0.15,
    /**
     * 16384 leaves headroom for coach (which embeds 6 domain insight bodies).
     * The cardio + activity prompts also approached the old 8192 ceiling.
     * Per-call overrides exist for VRAM-tuned cases (vision, surprise).
     */
    num_ctx: 16384,
    /**
     * Shared hard cap across every LLM call site. Schema grammar + EOS
     * normally stop far below this; the cap exists to bound qwen3.6's
     * occasional schema-ignoring runaway (double-emit) and to give the
     * widest v3 synthesis + vision prompts headroom without per-call
     * tuning. 32000 tokens ≈ 38 min at 14 tok/s — still inside llmTimeoutMs.
     */
    num_predict: 32000,
    top_p: 0.9,
  },
} as const;

/**
 * Lazy guard: surface a clear error the first time something actually tries
 * to use the DB path, but don't crash module init. Crashing at import time
 * breaks `next build` route-collection on machines where the Mac path is
 * absent (e.g. the Pi during build, or CI without secrets mounted).
 */
export function assertDbExists(): void {
  if (IS_NEXT_BUILD) return;
  if (!existsSync(config.dbPath)) {
    throw new Error(`Gadgetbridge.db not found at ${config.dbPath}`);
  }
}
