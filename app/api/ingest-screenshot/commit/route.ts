import "server-only";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { writeManualLog } from "@/lib/manual-log";
import { isAllowedScreenshotLabel } from "@/lib/screenshot-validator";

/**
 * POST /api/ingest-screenshot/commit
 *
 * Body: { fields: [{label, value, unit}], ts_iso? }
 *
 * Writes one PULSE_MANUAL_LOG row per accepted field. `label` MUST be in the
 * 7-allowed enum (defense in depth — the UI already filters, but never trust
 * the client). All rows share `ts_iso` so they can be grouped as a single
 * body-comp sample on read.
 *
 * Returns { ok: true, written: N }. After success, revalidates /log,
 * /day, /explore so the new values appear without a manual refresh.
 */

export const dynamic = "force-dynamic";

interface IncomingField {
  label: string;
  value: number;
  unit: string;
}

interface RequestBody {
  fields: IncomingField[];
  ts_iso?: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function validateBody(input: unknown): RequestBody | string {
  if (!isObject(input)) return "body must be a JSON object";
  const { fields, ts_iso } = input;
  if (!Array.isArray(fields) || fields.length === 0) {
    return "fields must be a non-empty array";
  }
  const out: IncomingField[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!isObject(f)) return `fields[${i}] must be an object`;
    const { label, value, unit } = f;
    if (typeof label !== "string" || !isAllowedScreenshotLabel(label)) {
      return `fields[${i}].label '${String(label)}' is not in the allowed enum`;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `fields[${i}].value must be a finite number`;
    }
    if (typeof unit !== "string" || unit.length === 0) {
      return `fields[${i}].unit must be a non-empty string`;
    }
    out.push({ label, value, unit });
  }
  let ts: string | undefined;
  if (ts_iso !== undefined) {
    if (typeof ts_iso !== "string" || !ISO_RE.test(ts_iso)) {
      return "ts_iso must be an ISO 8601 timestamp";
    }
    ts = ts_iso;
  }
  return { fields: out, ts_iso: ts };
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = validateBody(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const ts = parsed.ts_iso ?? new Date().toISOString();

  let written = 0;
  try {
    for (const f of parsed.fields) {
      writeManualLog({
        ts_iso: ts,
        metric: f.label,
        value: f.value,
        unit: f.unit,
        source: "huawei_screenshot",
        note: null,
      });
      written += 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-screenshot/commit] write failed after ${written} rows: ${msg}`);
    return NextResponse.json(
      { error: msg, written },
      { status: 500 },
    );
  }

  revalidatePath("/log");
  revalidatePath("/day", "layout");
  revalidatePath("/explore");
  revalidatePath("/", "page");

  return NextResponse.json({ ok: true, written });
}
