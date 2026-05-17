/**
 * Completion log — single source of truth for "which artifacts are finalised."
 *
 * Replaces the per-day sentinel-file zoo (`_complete`, `_v3_complete`,
 * `_sleep_complete`, …). Append-only JSONL at `$STATE_ROOT/completion-log.jsonl`,
 * mirrored into an in-memory set for O(1) lookup. Boot replays the log.
 *
 * Format per line: `{"ts":"<iso>","periodKey":"YYYY-MM-DD","artifact":"<name>"}`.
 *
 * Artifact names are stable strings, not file paths:
 *   v2_daily, v3_sleep, v3_recovery, v3_activity, v3_synthesis.
 *
 * Convenience predicates `isV2Complete` / `isV3Complete` aggregate over the
 * relevant artifact set.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { config } from "../config.ts";

export type V3Artifact =
  | "v3_sleep"
  | "v3_recovery"
  | "v3_activity"
  | "v3_training"
  | "v3_morning"
  | "v3_synthesis";
export type V2Artifact = "v2_daily";
export type Artifact = V2Artifact | V3Artifact;

export const V3_ARTIFACTS: readonly V3Artifact[] = [
  "v3_sleep",
  "v3_recovery",
  "v3_activity",
  "v3_training",
  "v3_morning",
  "v3_synthesis",
] as const;

interface LogEntry {
  ts: string;
  periodKey: string;
  artifact: Artifact;
}

const LOG_PATH = path.join(config.stateRoot, "completion-log.jsonl");

// Module-local mutable state. Kept internal — no exported accessor mutates it
// except via `markComplete` / `rewriteLog` / `_resetForTests`.
const seen = new Set<string>();
let loaded = false;

const key = (periodKey: string, artifact: Artifact): string => `${periodKey}|${artifact}`;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(LOG_PATH)) return;
  try {
    for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as Partial<LogEntry>;
        if (ev.periodKey && ev.artifact) seen.add(key(ev.periodKey, ev.artifact as Artifact));
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* no log yet */
  }
}

function ensureStateRoot(): void {
  if (!existsSync(config.stateRoot)) mkdirSync(config.stateRoot, { recursive: true });
}

export function markComplete(periodKey: string, artifact: Artifact): void {
  ensureLoaded();
  const k = key(periodKey, artifact);
  if (seen.has(k)) return;
  seen.add(k);
  ensureStateRoot();
  const line = JSON.stringify({ ts: new Date().toISOString(), periodKey, artifact } satisfies LogEntry) + "\n";
  appendFileSync(LOG_PATH, line, "utf8");
}

export function isComplete(periodKey: string, artifact: Artifact): boolean {
  ensureLoaded();
  return seen.has(key(periodKey, artifact));
}

export function isV3Complete(periodKey: string): boolean {
  return V3_ARTIFACTS.every((a) => isComplete(periodKey, a));
}

export function isV2Complete(periodKey: string): boolean {
  return isComplete(periodKey, "v2_daily");
}

/** Clear the in-memory cache. For tests only. */
export function _resetForTests(): void {
  seen.clear();
  loaded = false;
}

/** One-shot rewrite of the log from a known-good set. Used by backfill. */
export function rewriteLog(entries: LogEntry[]): void {
  ensureStateRoot();
  const tmp = `${LOG_PATH}.tmp`;
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, LOG_PATH);
  _resetForTests();
}
