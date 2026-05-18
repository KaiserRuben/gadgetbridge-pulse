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
  ingestOutboxPath:
    process.env.PULSE_INGEST_OUTBOX_PATH ??
    (existsSync("/data") ? "/data/ingest-outbox.db" : path.join(homedir(), ".pulse", "ingest-outbox.db")),

  /** Generation options shared across all prompts. */
  ollamaOptions: {
    temperature: 0.15,
    /**
     * 16384 leaves headroom for coach (which embeds 6 domain insight bodies).
     * The cardio + activity prompts also approached the old 8192 ceiling.
     */
    num_ctx: 16384,
    /**
     * Hard cap. qwen3.6 sometimes ignores the schema close-brace and keeps
     * generating a second copy. 6000 tokens gives all current and planned
     * schemas headroom:
     *   snapshot/sleep v2  ≈ 3300 tokens
     *   snapshot/coach     ≈ 3800 tokens (consumes 7 prior insights)
     *   week/<domain>      ≈ 4200 tokens (adds comparison + trend prose)
     *   month/<domain>     ≈ 4800 tokens (adds calendar variability blocks)
     *   year/<domain>      ≈ 5500 tokens (adds personal-records refs)
     * Worst-case generation time at ~14 tok/s ≈ 7 min; still acceptable for
     * a background batch run, while preventing unbounded 80k-token loops.
     */
    num_predict: 6000,
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
