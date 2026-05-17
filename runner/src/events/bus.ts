/**
 * Pulse event bus.
 *
 * All pipeline work is event-driven. Sources detect state changes and call
 * `bus.emit(...)`; subscribers register with `bus.on(kind, handler)` and run
 * serially per `periodKey` so the GPU stays single-tenant.
 *
 * Persistence: every emitted event is appended to `state/events.jsonl` with a
 * stable `id` so dedupe survives process restarts.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { config } from "../config.ts";
import { log, withContext } from "../logger.ts";

export type EventKind =
  | "sleep_complete"
  | "workout_complete"
  | "day_end"
  | "manual"
  | "meal_logged_pending"
  | "meal_classified"
  | "meal_edited";

export interface PulseEvent {
  id: string;
  kind: EventKind;
  periodKey: string;
  ts: number;
  payload: Record<string, unknown>;
}

export type Handler = (ev: PulseEvent) => Promise<void> | void;

const EVENTS_LOG = path.join(config.stateRoot, "events.jsonl");

function eventId(kind: EventKind, periodKey: string, ts: number): string {
  return createHash("sha1")
    .update(`${kind}|${periodKey}|${ts}`)
    .digest("hex")
    .slice(0, 16);
}

class Bus {
  private subs = new Map<EventKind, Handler[]>();
  private locks = new Map<string, Promise<unknown>>();
  private seen = new Set<string>();
  private loaded = false;

  on(kind: EventKind, handler: Handler): void {
    const list = this.subs.get(kind) ?? [];
    list.push(handler);
    this.subs.set(kind, list);
  }

  /**
   * Emit an event. Returns the persisted event (with id), or `null` if it was
   * deduped against the log. Subscribers run serially per periodKey — multiple
   * events for the same period queue behind one another, while different
   * periods proceed in parallel.
   */
  async emit(
    kind: EventKind,
    periodKey: string,
    payload: Record<string, unknown> = {},
    tsOverride?: number,
  ): Promise<PulseEvent | null> {
    await this.ensureLoaded();
    const ts = tsOverride ?? Date.now();
    const id = eventId(kind, periodKey, ts);
    if (this.seen.has(id)) return null;
    const ev: PulseEvent = { id, kind, periodKey, ts, payload };
    this.seen.add(id);
    await this.appendLog(ev);
    await this.dispatch(ev);
    return ev;
  }

  private async dispatch(ev: PulseEvent): Promise<void> {
    const handlers = this.subs.get(ev.kind) ?? [];
    if (handlers.length === 0) return;
    const prev = this.locks.get(ev.periodKey) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        await withContext({ kind: ev.kind, periodKey: ev.periodKey }, async () => {
          for (const h of handlers) {
            try {
              await h(ev);
            } catch (err) {
              log.error("bus", `handler failed: ${(err as Error).message}`);
            }
          }
        });
      });
    this.locks.set(ev.periodKey, next);
    await next;
    if (this.locks.get(ev.periodKey) === next) this.locks.delete(ev.periodKey);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const txt = await readFile(EVENTS_LOG, "utf8");
      for (const line of txt.split("\n")) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as PulseEvent;
          if (ev.id) this.seen.add(ev.id);
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* no log yet */
    }
  }

  private async appendLog(ev: PulseEvent): Promise<void> {
    await mkdir(path.dirname(EVENTS_LOG), { recursive: true });
    await appendFile(EVENTS_LOG, JSON.stringify(ev) + "\n", "utf8");
  }
}

export const bus = new Bus();
