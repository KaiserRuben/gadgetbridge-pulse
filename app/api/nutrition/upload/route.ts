import "server-only";
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createPendingMeal } from "@/lib/data/meal-store";
import { inboxPathFor } from "@/lib/nutrition/paths";
import { localDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
/** Hard cap so a runaway client can't queue a 100-photo VLM call. */
const MAX_PHOTOS_PER_MEAL = 4;
const PHOTO_KINDS = new Set(["meal", "label", "context"]);

interface SidecarPhoto {
  ord: number;
  path: string;
  mime: string;
  kind: "meal" | "label" | "context" | null;
}

/**
 * Collect every uploaded image. Clients can submit them as either:
 *   - One field name repeated: `images=<file1>&images=<file2>` (preferred).
 *   - Indexed fields: `images[0]=<file1>&images[1]=<file2>`.
 *   - Legacy single field: `image=<file>` (still supported).
 *
 * `kind_<i>` (e.g. `kind_0=meal`, `kind_1=label`) is an optional per-photo
 * hint to the VLM. Falls back to null when absent.
 */
function collectImages(form: FormData): Array<{ file: File; kind: string | null }> {
  const out: Array<{ file: File; kind: string | null }> = [];
  // Repeated "images" entries (preferred path for browser FormData).
  const repeated = form.getAll("images");
  repeated.forEach((entry, idx) => {
    if (entry instanceof File && entry.size > 0) {
      const kind = (form.get(`kind_${idx}`) as string | null) ?? null;
      out.push({ file: entry, kind });
    }
  });
  // Legacy single "image" field.
  const single = form.get("image");
  if (single instanceof File && single.size > 0) {
    out.push({ file: single, kind: (form.get("kind") as string | null) ?? null });
  }
  return out;
}

function normaliseKind(raw: string | null): "meal" | "label" | "context" | null {
  if (!raw) return null;
  return PHOTO_KINDS.has(raw) ? (raw as "meal" | "label" | "context") : null;
}

export async function POST(req: Request): Promise<Response> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `failed to parse multipart: ${err instanceof Error ? err.message : err}` },
      { status: 400 },
    );
  }

  const images = collectImages(form);
  const userText = (form.get("text") as string | null)?.trim() || null;
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const mealAtRaw = (form.get("meal_at") as string | null) ?? null;

  if (images.length === 0 && !userText) {
    return NextResponse.json(
      { error: "at least one image or 'text' is required" },
      { status: 400 },
    );
  }
  if (images.length > MAX_PHOTOS_PER_MEAL) {
    return NextResponse.json(
      { error: `at most ${MAX_PHOTOS_PER_MEAL} photos per meal (got ${images.length})` },
      { status: 413 },
    );
  }

  // Validate every photo BEFORE writing any to disk — partial writes after
  // a validation error are a leak we don't want to clean up.
  for (const { file } of images) {
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: `photo "${file.name || "unknown"}" exceeds ${MAX_PHOTO_BYTES} bytes` },
        { status: 413 },
      );
    }
    const mime = (file.type || "").toLowerCase();
    if (!ACCEPTED_MIME.has(mime)) {
      return NextResponse.json(
        { error: `unsupported image type "${mime || "unknown"}" for "${file.name || "unknown"}"` },
        { status: 415 },
      );
    }
  }

  const mealAtIso = parseMealAt(mealAtRaw);
  const periodKey = localDateKey(Math.floor(new Date(mealAtIso).getTime() / 1000));
  const mealId = randomUUID();

  const writtenPhotos: SidecarPhoto[] = [];
  for (let idx = 0; idx < images.length; idx++) {
    const { file, kind } = images[idx];
    const mime = file.type.toLowerCase();
    const ext = EXT_BY_MIME[mime] ?? "bin";
    // Photos beyond the cover get an `_<ord>` suffix so they don't collide.
    // ord=0 keeps the bare `<mealId>.<ext>` filename so old read paths that
    // assume a single cover photo still work.
    const filename = idx === 0 ? `${mealId}.${ext}` : `${mealId}_${idx}.${ext}`;
    const absPath = inboxPathFor(periodKey, filename);
    try {
      await mkdir(path.dirname(absPath), { recursive: true });
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(absPath, buf);
    } catch (err) {
      return NextResponse.json(
        {
          error: `failed to persist photo ${idx}: ${err instanceof Error ? err.message : err}`,
        },
        { status: 500 },
      );
    }
    writtenPhotos.push({
      ord: idx,
      path: `inbox/${periodKey}/${filename}`,
      mime,
      kind: normaliseKind(kind),
    });
  }

  try {
    createPendingMeal({
      id: mealId,
      user_meal_at: mealAtIso,
      period_key: periodKey,
      photos: writtenPhotos.map((p) => ({
        path: p.path,
        mime: p.mime,
        kind: p.kind,
      })),
      user_text: userText,
      notes,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `failed to insert meal row: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    );
  }

  // pulse.db is the classify queue (status='pending'). The Mac runner's
  // reconciler picks it up on its next tick; no sidecar JSON written.

  return NextResponse.json({
    meal_id: mealId,
    period_key: periodKey,
    status: "pending",
    photo_path: writtenPhotos[0]?.path ?? null,
    photos: writtenPhotos.map((p) => ({ ord: p.ord, path: p.path, mime: p.mime, kind: p.kind })),
  });
}

function parseMealAt(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}
