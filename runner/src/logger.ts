/**
 * Structured logger for the runner.
 *
 * Two output modes, switched by `RUNNER_LOG_JSON`:
 *
 *   text (default):
 *     `2026-05-15T12:34:56.789Z I [day_end 2026-05-13] run=v3:sleep:2026-05-13:1:1234ab stage4_prose ok 61919ms`
 *
 *   json (RUNNER_LOG_JSON=1):
 *     `{"ts":"…","lvl":"info","ctx":{"kind":"day_end","periodKey":"…"},"run_id":"…","tag":"stage4_prose","msg":"ok 61919ms","elapsed_ms":61919}`
 *
 * Fields:
 *   1. ISO timestamp (UTC, ms precision)
 *   2. level — `I` info, `W` warn, `E` err
 *   3. optional context `[<kind> <periodKey>]` from `withContext`
 *   4. optional `run=<run_id>` from a `withContext({ runId })` scope — lets
 *      every sub-log of a run share a greppable correlation id.
 *   5. tag — short identifier (e.g. `stage4_prose`, `v3:sleep`, `sub`)
 *   6. free-form message.
 *
 * Levels can be filtered via `RUNNER_LOG_LEVEL=debug|info|warn|error` (default info).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  kind?: string;
  periodKey?: string;
  /**
   * Correlation id for a logical "run" (a cluster execution, a stage, an
   * Ollama call). Set by `runStage()` / run-tracker so every nested
   * `log.*` call carries the same id without parameter threading.
   */
  runId?: string;
  /** Extra structured fields merged into json-mode output. */
  fields?: Record<string, unknown>;
}

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: -1, info: 0, warn: 1, error: 2 };
const LEVEL_GLYPH: Record<Level, string> = { debug: "D", info: "I", warn: "W", error: "E" };

const envLevel = (process.env.RUNNER_LOG_LEVEL ?? "info").toLowerCase();
const minLevel: Level = (["debug", "info", "warn", "error"] as const).includes(envLevel as Level)
  ? (envLevel as Level)
  : "info";

const JSON_MODE = (() => {
  const v = (process.env.RUNNER_LOG_JSON ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
})();

const storage = new AsyncLocalStorage<LogContext>();

function ctxPrefix(): string {
  const c = storage.getStore();
  if (!c) return "";
  const parts: string[] = [];
  if (c.kind && c.periodKey) parts.push(`[${c.kind} ${c.periodKey}]`);
  else if (c.kind || c.periodKey) parts.push(`[${c.kind ?? c.periodKey}]`);
  if (c.runId) parts.push(`run=${c.runId}`);
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function emitText(level: Level, tag: string, msg: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} ${LEVEL_GLYPH[level]}${ctxPrefix()} ${tag} ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function emitJson(level: Level, tag: string, msg: string): void {
  const c = storage.getStore();
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    lvl: level,
    tag,
    msg,
  };
  if (c?.kind) record.kind = c.kind;
  if (c?.periodKey) record.period_key = c.periodKey;
  if (c?.runId) record.run_id = c.runId;
  if (c?.fields) Object.assign(record, c.fields);
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function emit(level: Level, tag: string, msg: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  if (JSON_MODE) emitJson(level, tag, msg);
  else emitText(level, tag, msg);
}

export const log = {
  debug: (tag: string, msg: string): void => emit("debug", tag, msg),
  info: (tag: string, msg: string): void => emit("info", tag, msg),
  warn: (tag: string, msg: string): void => emit("warn", tag, msg),
  error: (tag: string, msg: string): void => emit("error", tag, msg),
};

/**
 * Run `fn` with the given log context attached. All `log.*` calls made
 * synchronously OR through awaited descendants inherit it, so deeply-nested
 * stage logs auto-carry the periodKey/event kind without parameter threading.
 *
 * When called inside an existing context, fields are merged (child wins on
 * conflict). Lets a stage attach a `runId` on top of the outer event ctx.
 */
export function withContext<T>(ctx: LogContext, fn: () => T | Promise<T>): T | Promise<T> {
  const parent = storage.getStore();
  const merged: LogContext = parent
    ? {
        ...parent,
        ...ctx,
        fields: { ...(parent.fields ?? {}), ...(ctx.fields ?? {}) },
      }
    : { ...ctx };
  return storage.run(merged, fn);
}

/** Read the currently-active context (for the rare case a caller needs it). */
export function currentContext(): LogContext | undefined {
  return storage.getStore();
}

/** Whether JSON-mode output is active — handy for skip-paths in hot loops. */
export function isJsonMode(): boolean {
  return JSON_MODE;
}
