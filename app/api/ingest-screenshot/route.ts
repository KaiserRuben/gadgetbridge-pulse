import "server-only";
import { NextResponse } from "next/server";

import { resizeForVision } from "@/lib/image-resize";
import { validateExtraction } from "@/lib/screenshot-validator";
import { extractScreenshot } from "@/runner/analyzer/screenshot-extractor.ts";

/**
 * POST /api/ingest-screenshot
 *
 * Multipart/form-data with field `image` (jpeg/png/webp). Resizes server-side
 * (long-edge ≤ 640 px, JPEG q80 — required by PROBE_vision.md to keep latency
 * inside the 120s timeout), base64-encodes, calls Ollama qwen3.6 vision, then
 * runs the post-validator.
 *
 * Returns { extraction, validation }. Does NOT write to the DB — the user
 * must explicitly confirm via POST /api/ingest-screenshot/commit. This
 * preserves the human-in-the-loop step the v2.1 interaction map requires.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
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
      {
        error: `failed to parse multipart form: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 },
    );
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json(
      { error: "missing 'image' file field" },
      { status: 400 },
    );
  }

  const mime = (image.type || "").toLowerCase();
  if (!ACCEPTED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `unsupported image type '${mime || "unknown"}' — accepted: jpeg, png, webp` },
      { status: 400 },
    );
  }

  const ab = await image.arrayBuffer();
  const inputBuffer = Buffer.from(ab);
  if (inputBuffer.byteLength === 0) {
    return NextResponse.json({ error: "empty image upload" }, { status: 400 });
  }

  let resized: Buffer;
  try {
    resized = await resizeForVision(inputBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-screenshot] resize failed: ${msg}`);
    return NextResponse.json({ error: `resize failed: ${msg}` }, { status: 500 });
  }

  const base64 = resized.toString("base64");

  let extraction;
  try {
    extraction = await extractScreenshot(base64, {
      ollamaUrl: OLLAMA_URL,
      timeoutMs: 120_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-screenshot] vision call failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const validation = validateExtraction(extraction);
  if (!validation.ok) {
    console.warn(
      `[ingest-screenshot] validator warnings: ${validation.warnings.join("; ")}`,
    );
  }

  return NextResponse.json({ extraction, validation });
}
