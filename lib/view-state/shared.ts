/**
 * Shared view-state utilities for app + API routes.
 *
 * - `detectScope` — single regex test for daily / weekly period keys.
 * - `getReader` / `getWriter` — process-lifetime singletons; the underlying
 *   classes hold no per-request state, so re-using one instance keeps the
 *   default-root resolution out of the hot path.
 */

import {
  ViewStateReader,
} from "@/runner/v4/view-state/reader.ts";
import {
  ViewStateWriter,
} from "@/runner/v4/view-state/writer.ts";
import type { Scope } from "@/runner/v4/types.ts";

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKLY_RE = /^\d{4}-W\d{2}$/;

export function detectScope(period_key: string): Scope | null {
  if (DAILY_RE.test(period_key)) return "daily";
  if (WEEKLY_RE.test(period_key)) return "weekly";
  return null;
}

let _reader: ViewStateReader | null = null;
let _writer: ViewStateWriter | null = null;

export function getReader(): ViewStateReader {
  if (!_reader) _reader = new ViewStateReader();
  return _reader;
}

export function getWriter(): ViewStateWriter {
  if (!_writer) _writer = new ViewStateWriter();
  return _writer;
}
