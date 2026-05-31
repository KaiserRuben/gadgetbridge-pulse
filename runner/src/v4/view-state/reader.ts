/**
 * View-state reader.
 *
 * Two modes:
 *   - disk mode (default): reads PULSE_VIEW_ROOT/<scope>/<key>.json.
 *     Used by the Pi (single-writer + reader of its own view tree) and by
 *     tests with a temp view_root.
 *   - HTTP mode (`pi_base_url` set): GETs /api/view/<key> from the Pi.
 *     Used by the Mac daemon to ask the Pi for the authoritative current
 *     state before constructing CAS-checked diffs. Without this, the Mac
 *     would always see version=0 (no local copy of the view tree) and
 *     every Tier1/Slot diff would 409.
 *
 * Returns null on miss (caller decides whether to build initial).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { Scope, ViewState } from "../types.ts";
import { defaultViewRoot } from "./writer.ts";

export interface ReaderOptions {
  /** Disk root for view docs. Ignored when `pi_base_url` is set. */
  view_root?: string;
  /** If set, reader fetches Pi over HTTP instead of reading disk. */
  pi_base_url?: string;
  /** Test seam — defaults to global fetch. */
  fetch_impl?: typeof fetch;
  /** Per-request timeout for HTTP mode. Default 10s. */
  request_timeout_ms?: number;
}

export class ViewStateReader {
  private readonly root: string;
  private readonly piBase: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ReaderOptions = {}) {
    this.root = opts.view_root ?? defaultViewRoot();
    this.piBase = opts.pi_base_url?.replace(/\/$/, "") ?? null;
    this.fetchImpl = opts.fetch_impl ?? fetch;
    this.timeoutMs = opts.request_timeout_ms ?? 10_000;
  }

  filePath(scope: Scope, period_key: string): string {
    const subdir = scope === "weekly" ? "weekly" : "daily";
    return path.join(this.root, subdir, `${period_key}.json`);
  }

  async read(scope: Scope, period_key: string): Promise<ViewState | null> {
    if (this.piBase) return this.readHttp(period_key);
    return this.readDisk(scope, period_key);
  }

  private async readDisk(scope: Scope, period_key: string): Promise<ViewState | null> {
    try {
      const raw = await fs.readFile(this.filePath(scope, period_key), "utf8");
      return this.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async readHttp(period_key: string): Promise<ViewState | null> {
    const url = `${this.piBase}/api/view/${encodeURIComponent(period_key)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`view fetch ${url} → HTTP ${response.status}`);
    }
    return this.parse(await response.text());
  }

  private parse(raw: string): ViewState {
    const parsed = JSON.parse(raw) as ViewState;
    if (parsed.schema_version !== "view/v1") {
      throw new Error(
        `Unsupported view-state schema_version: ${parsed.schema_version}`,
      );
    }
    return parsed;
  }
}
