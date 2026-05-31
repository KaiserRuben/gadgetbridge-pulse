/**
 * View-state writer (Pi-resident logic).
 *
 * The Pi is the single-writer for PULSE_VIEW_ROOT/<scope>/<key>.json
 * (see defaultViewRoot for the resolution order). The Mac POSTs SlotDiff /
 * Tier1Diff / MetaDiff to the Pi ingest API; the route calls into this
 * writer. No Mac-side process touches the file directly — that's what keeps
 * Syncthing out of the loop and prevents the bidirectional-write corruption
 * pattern that bit pulse.db.
 *
 * Atomic merge contract:
 *   1. Read current view (or build initial)
 *   2. CAS check: diff.expected_version must equal current.version (or 0
 *      for first write)
 *   3. Apply diff to in-memory copy
 *   4. Bump current.version, set generated_at = now
 *   5. Write to staging path, fsync, atomic rename to final path
 *   6. (SSE consumers pick up the rename via fs.watch in the API route.)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  MetaDiff,
  Scope,
  SlotDiff,
  Tier1Diff,
  ViewState,
} from "../types.ts";
import { buildInitial } from "./builder.ts";

export interface WriterOptions {
  /** Root path for view docs (defaults to $PULSE_VIEW_ROOT or $INSIGHTS_ROOT/view). */
  view_root?: string;
  /** Now provider for tests. */
  now?: () => Date;
}

export class VersionConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`view-state version conflict: expected ${expected}, got ${actual}`);
    this.name = "VersionConflictError";
  }
}

export class ViewStateWriter {
  private readonly root: string;
  private readonly now: () => Date;

  constructor(opts: WriterOptions = {}) {
    this.root = opts.view_root ?? defaultViewRoot();
    this.now = opts.now ?? (() => new Date());
  }

  filePath(scope: Scope, period_key: string): string {
    const subdir = scope === "weekly" ? "weekly" : "daily";
    return path.join(this.root, subdir, `${period_key}.json`);
  }

  async read(scope: Scope, period_key: string): Promise<ViewState | null> {
    try {
      const raw = await fs.readFile(this.filePath(scope, period_key), "utf8");
      return JSON.parse(raw) as ViewState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async readOrInit(scope: Scope, period_key: string): Promise<ViewState> {
    const existing = await this.read(scope, period_key);
    if (existing) return existing;
    return buildInitial(period_key, scope, this.now());
  }

  async applyTier1(diff: Tier1Diff): Promise<ViewState> {
    return this.applyDiff(diff.scope, diff.period_key, diff.expected_version, (view) => {
      view.tier1 = diff.tier1;
    });
  }

  async applySlot<P = unknown>(diff: SlotDiff<P>): Promise<ViewState> {
    return this.applyDiff(diff.scope, diff.period_key, diff.expected_version, (view) => {
      if (diff.slot_id === "post_workout" || diff.slot_id === "anomaly_explain") {
        if (!diff.event_id) {
          throw new Error(`Event slot ${diff.slot_id} requires event_id`);
        }
        // events[slot_id] are discriminated unions; treat as opaque arrays of
        // entries-with-event_id while merging. The Pi-side API route is the
        // one place that owns this loose typing — call sites push typed
        // entries via SlotDiff<P>.
        const list = view.events[diff.slot_id] as Array<{ event_id: string; version: number }>;
        const idx = list.findIndex((e) => e.event_id === diff.event_id);
        const baseVersion = idx >= 0 ? list[idx].version : 0;
        const merged = {
          ...(idx >= 0 ? list[idx] : {}),
          ...diff.entry,
          event_id: diff.event_id,
          version: baseVersion + 1,
        };
        if (idx >= 0) {
          list[idx] = merged as (typeof list)[number];
        } else {
          list.push(merged as (typeof list)[number]);
        }
      } else {
        // Fixed slot — daily or weekly. view.slots is a discriminated union
        // on scope; loose-type the indexed write so this writer covers both
        // scopes without per-scope branches.
        const slots = view.slots as unknown as Record<string, { version?: number }>;
        const current = slots[diff.slot_id];
        slots[diff.slot_id] = {
          ...diff.entry,
          version: (current?.version ?? 0) + 1,
        } as typeof current;
      }
    });
  }

  async applyMeta(diff: MetaDiff): Promise<ViewState> {
    return this.applyDiff(diff.scope, diff.period_key, diff.expected_version, (view) => {
      view.meta = { ...view.meta, ...diff.meta };
    });
  }

  /**
   * Apply an arbitrary mutation under CAS + atomic-rename.
   */
  private async applyDiff(
    scope: Scope,
    period_key: string,
    expected_version: number,
    mutate: (view: ViewState) => void,
  ): Promise<ViewState> {
    const current = await this.readOrInit(scope, period_key);
    if (current.version !== expected_version) {
      throw new VersionConflictError(expected_version, current.version);
    }
    // shallow-clone safe enough — mutate replaces top-level keys atomically
    const next = JSON.parse(JSON.stringify(current)) as ViewState;
    mutate(next);
    next.version = current.version + 1;
    next.generated_at = this.now().toISOString();
    await this.write(next);
    return next;
  }

  /**
   * Atomic write: staging → fsync → rename.
   */
  private async write(view: ViewState): Promise<void> {
    const final = this.filePath(view.scope, view.period_key);
    const staging = `${final}.tmp.${process.pid}.${Date.now()}`;
    await fs.mkdir(path.dirname(final), { recursive: true });
    const handle = await fs.open(staging, "w");
    try {
      await handle.writeFile(JSON.stringify(view, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(staging, final);
  }
}

/**
 * Resolve the view-root in priority order:
 *   1. PULSE_VIEW_ROOT (explicit override)
 *   2. INSIGHTS_ROOT/view
 *   3. PULSE_ROOT/insights/view (matches runner/src/config.ts)
 *   4. ./insights/view (final fallback)
 */
export function defaultViewRoot(): string {
  if (process.env.PULSE_VIEW_ROOT) return process.env.PULSE_VIEW_ROOT;
  if (process.env.INSIGHTS_ROOT) {
    return path.join(process.env.INSIGHTS_ROOT, "view");
  }
  if (process.env.PULSE_ROOT) {
    return path.join(process.env.PULSE_ROOT, "insights", "view");
  }
  return path.join("./insights", "view");
}
