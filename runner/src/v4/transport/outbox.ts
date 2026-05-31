/**
 * Mac → Pi view-state diff outbox.
 *
 * Receives Tier1Diff / SlotDiff / MetaDiff objects, POSTs them to the Pi
 * ingest API with CAS retry. On network/HTTP error, persists to disk so
 * a daemon restart can replay.
 *
 * Wire format — POST {PI_INGEST_BASE}/api/ingest/view/{date}
 *   body: { kind: "tier1" | "slot" | "meta", ...diff }
 *
 *   - 200 → { ok: true, version: <new_view.version> }
 *   - 409 → { ok: false, code: "version_conflict", current_version: N }
 *   - 5xx → retry-with-backoff (persisted)
 *
 * On CAS conflict, the caller re-reads the view, rebuilds the diff with
 * the new expected_version, and resubmits. The outbox itself does not
 * rebuild — that requires slot context — but it surfaces the conflict
 * back to the caller via the result.
 *
 * Phase 2 surface: the daemon constructs diffs and pushes them in via
 * `submit()`. Replay-on-startup arrives in Phase 2b.
 */

import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { MetaDiff, SlotDiff, Tier1Diff } from "../types.ts";

export type DiffKind = "tier1" | "slot" | "meta";

export type AnyDiff = Tier1Diff | SlotDiff | MetaDiff;

export interface OutboxItem {
  kind: DiffKind;
  diff: AnyDiff;
}

export interface OutboxOptions {
  /** Pi base URL, e.g. "http://pulse.tail123.ts.net". */
  pi_base_url?: string;
  /** Persistent queue directory (defaults to $PULSE_STATE_ROOT/outbox-v4). */
  queue_dir?: string;
  /**
   * Caller-injected fetch (tests, ts-node ESM). Defaults to undici fetch.
   */
  fetch_impl?: typeof fetch;
  /** Per-request timeout. Default 30s. */
  request_timeout_ms?: number;
}

export interface SubmitResult {
  ok: boolean;
  /** HTTP status code (0 if network error before reaching server). */
  status: number;
  /** "version_conflict" if the Pi rejected the CAS. */
  code: string | null;
  /** Pi's reported current view.version after successful merge or on conflict. */
  current_version: number | null;
  /** Persisted to queue for retry? */
  queued: boolean;
  /** Queue file path if queued. */
  queue_path: string | null;
  /** Error if any. */
  error: string | null;
}

export class Outbox {
  private readonly base: string;
  private readonly queueDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OutboxOptions = {}) {
    this.base =
      opts.pi_base_url ?? process.env.PULSE_PI_BASE_URL ?? "http://localhost:3030";
    this.queueDir =
      opts.queue_dir ??
      path.join(
        process.env.PULSE_STATE_ROOT ??
          path.join(process.env.HOME ?? ".", ".pulse-state"),
        "outbox-v4",
      );
    this.fetchImpl = opts.fetch_impl ?? fetch;
    this.timeoutMs = opts.request_timeout_ms ?? 30_000;
  }

  async submit(item: OutboxItem): Promise<SubmitResult> {
    const url = this.buildUrl(item.diff.period_key);
    const body = JSON.stringify({ kind: item.kind, ...item.diff });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const text = await response.text();
      const parsed = safeJson(text) as
        | { ok?: boolean; code?: string; current_version?: number; version?: number }
        | null;

      if (response.status === 200 && parsed?.ok) {
        return {
          ok: true,
          status: 200,
          code: null,
          current_version: parsed.version ?? null,
          queued: false,
          queue_path: null,
          error: null,
        };
      }
      if (response.status === 409) {
        return {
          ok: false,
          status: 409,
          code: parsed?.code ?? "version_conflict",
          current_version: parsed?.current_version ?? null,
          queued: false,
          queue_path: null,
          error: null,
        };
      }
      // Other failure → queue for retry.
      const queuePath = await this.persist(item, `status_${response.status}: ${text.slice(0, 200)}`);
      return {
        ok: false,
        status: response.status,
        code: parsed?.code ?? null,
        current_version: parsed?.current_version ?? null,
        queued: true,
        queue_path: queuePath,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const queuePath = await this.persist(item, message);
      return {
        ok: false,
        status: 0,
        code: null,
        current_version: null,
        queued: true,
        queue_path: queuePath,
        error: message,
      };
    }
  }

  /**
   * Replay any persisted items in queue_dir. Items that resubmit successfully
   * (200 or a non-retryable response like 409) are removed from disk.
   *
   * Returns the count of items replayed (regardless of outcome) so the daemon
   * can log "replayed N items on startup".
   */
  async drainQueue(): Promise<{ replayed: number; remaining: number }> {
    await mkdir(this.queueDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = (await readdir(this.queueDir)).filter((e) => e.endsWith(".json"));
    } catch {
      return { replayed: 0, remaining: 0 };
    }
    let replayed = 0;
    let remaining = 0;
    for (const file of entries) {
      const full = path.join(this.queueDir, file);
      try {
        const raw = await readFile(full, "utf8");
        const blob = JSON.parse(raw) as { item?: OutboxItem } | OutboxItem;
        // persist() wraps items with {enqueued_at, reason, item}. Older payloads
        // (or test-injected raw items) lack the wrapper — accept both.
        const item: OutboxItem =
          ((blob as { item?: OutboxItem }).item ?? (blob as OutboxItem));
        const result = await this.submit(item);
        replayed++;
        if (result.ok || result.status === 409) {
          // Drop on either success or CAS conflict (the caller should rebuild).
          await unlink(full).catch(() => undefined);
        } else {
          remaining++;
        }
      } catch {
        remaining++;
      }
    }
    return { replayed, remaining };
  }

  private buildUrl(periodKey: string): string {
    return `${this.base.replace(/\/$/, "")}/api/ingest/view/${encodeURIComponent(periodKey)}`;
  }

  private async persist(item: OutboxItem, reason: string): Promise<string> {
    await mkdir(this.queueDir, { recursive: true });
    const name = `${Date.now()}_${randomUUID()}.json`;
    const file = path.join(this.queueDir, name);
    const blob = {
      enqueued_at: new Date().toISOString(),
      reason,
      item,
    };
    await writeFile(file, JSON.stringify(blob), "utf8");
    return file;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
