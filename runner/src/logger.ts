/**
 * Structured logger for the runner.
 *
 * Output shape:
 *   `2026-05-15T12:34:56.789Z I [day_end 2026-05-13] stage4_prose ok 61919ms`
 *
 * Fields:
 *   1. ISO timestamp (UTC, ms precision)
 *   2. level — `I` info, `W` warn, `E` err
 *   3. optional context `[<kind> <periodKey>]` — set by `withContext` (usually
 *      around an event handler) so every line emitted under that scope carries
 *      the date+event without callers passing it through.
 *   4. tag — short identifier (e.g. `stage4_prose`, `v3:sleep`, `sub`)
 *   5. free-form message.
 *
 * Levels can be filtered via `RUNNER_LOG_LEVEL=info|warn|error` (default info).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  kind?: string;
  periodKey?: string;
}

type Level = "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { info: 0, warn: 1, error: 2 };
const LEVEL_GLYPH: Record<Level, string> = { info: "I", warn: "W", error: "E" };

const envLevel = (process.env.RUNNER_LOG_LEVEL ?? "info").toLowerCase();
const minLevel: Level = (["info", "warn", "error"] as const).includes(envLevel as Level)
  ? (envLevel as Level)
  : "info";

const storage = new AsyncLocalStorage<LogContext>();

function ctxPrefix(): string {
  const c = storage.getStore();
  if (!c || (!c.kind && !c.periodKey)) return "";
  if (c.kind && c.periodKey) return ` [${c.kind} ${c.periodKey}]`;
  return ` [${c.kind ?? c.periodKey}]`;
}

function emit(level: Level, tag: string, msg: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${LEVEL_GLYPH[level]}${ctxPrefix()} ${tag} ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (tag: string, msg: string): void => emit("info", tag, msg),
  warn: (tag: string, msg: string): void => emit("warn", tag, msg),
  error: (tag: string, msg: string): void => emit("error", tag, msg),
};

/**
 * Run `fn` with the given log context attached. All `log.*` calls made
 * synchronously OR through awaited descendants inherit it, so deeply-nested
 * stage logs auto-carry the periodKey/event kind without parameter threading.
 */
export function withContext<T>(ctx: LogContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run({ ...ctx }, fn);
}

/** Read the currently-active context (for the rare case a caller needs it). */
export function currentContext(): LogContext | undefined {
  return storage.getStore();
}
