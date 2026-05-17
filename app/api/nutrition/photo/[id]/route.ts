import "server-only";
import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { readMeal } from "@/lib/data/meal-store";
import { nutritionPaths } from "@/lib/nutrition/paths";

export const dynamic = "force-dynamic";

const MIME_FALLBACK: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

/**
 * Serve a photo attached to a meal. ?i=N picks the photo at ord=N (0-indexed).
 * Default is the cover (ord=0). The legacy single-photo path falls through
 * to PULSE_MEAL.photo_path when photos[] is empty (e.g. older rows that
 * predate the M010 migration backfill).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meal = readMeal(id);
  if (!meal) return NextResponse.json({ error: "no meal" }, { status: 404 });

  const url = new URL(req.url);
  const iRaw = url.searchParams.get("i");
  const ord = iRaw == null ? 0 : Number(iRaw);
  if (!Number.isFinite(ord) || ord < 0 || ord > 16) {
    return NextResponse.json({ error: "invalid ?i parameter" }, { status: 400 });
  }

  // Prefer the photos[] array (post-M010). Fall back to the legacy cover
  // pointer for any row whose photos[] never materialised — keeps old
  // dashboard reads working during the migration window.
  let photoRel: string | null = null;
  let photoMime: string | null = null;
  if (meal.photos.length > 0) {
    const hit = meal.photos.find((p) => p.ord === ord) ?? (ord === 0 ? meal.photos[0] : null);
    if (!hit) return NextResponse.json({ error: "photo index out of range" }, { status: 404 });
    photoRel = hit.path;
    photoMime = hit.mime;
  } else if (ord === 0 && meal.photo_path) {
    photoRel = meal.photo_path;
    photoMime = meal.photo_mime;
  } else {
    return NextResponse.json({ error: "no photo" }, { status: 404 });
  }

  const abs = path.join(nutritionPaths.mealsRoot, photoRel);
  const relCheck = path.relative(nutritionPaths.mealsRoot, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  try {
    await stat(abs);
  } catch {
    return NextResponse.json({ error: "photo file missing" }, { status: 404 });
  }
  const buf = await readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = photoMime ?? MIME_FALLBACK[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
