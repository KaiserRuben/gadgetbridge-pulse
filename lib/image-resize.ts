import "server-only";

/**
 * Server-side image resize for vision LLM input.
 *
 * Per PROBE_vision.md: a 974×791 JPEG (426 KB) timed out at 120s, while a
 * 640×520 thumbnail (48 KB) returned in 57.7s. We pre-resize to long-edge
 * ≤ 640 px and re-encode as JPEG quality 80 before sending to Ollama.
 *
 * Sharp is the primary path. If sharp is missing or errors out, we log a
 * warning and pass the original buffer through — the request may then time
 * out, but that's better than a hard failure on a misconfigured deployment.
 */

const TARGET_LONG_EDGE = 640;
const JPEG_QUALITY = 80;

interface SharpInstance {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(opts: { width?: number; height?: number; fit?: "inside" }): SharpInstance;
  jpeg(opts: { quality: number; mozjpeg?: boolean }): SharpInstance;
  toBuffer(): Promise<Buffer>;
  rotate(): SharpInstance;
}

type SharpFactory = (input: Buffer) => SharpInstance;

let _sharp: SharpFactory | null | undefined;

async function loadSharp(): Promise<SharpFactory | null> {
  if (_sharp !== undefined) return _sharp;
  try {
    const mod = (await import("sharp")) as
      | { default: SharpFactory }
      | SharpFactory;
    _sharp = (typeof mod === "function" ? mod : mod.default) ?? null;
  } catch (err) {
    console.warn(
      `[image-resize] sharp unavailable, vision call may time out: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    _sharp = null;
  }
  return _sharp;
}

/**
 * Resize image so its long edge is ≤ 640 px and re-encode as JPEG q80.
 * If sharp is unavailable or errors, returns the input buffer unchanged
 * with a console warning.
 */
export async function resizeForVision(buffer: Buffer): Promise<Buffer> {
  const sharp = await loadSharp();
  if (!sharp) return buffer;

  try {
    const meta = await sharp(buffer).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const longEdge = Math.max(w, h);

    let pipeline = sharp(buffer).rotate(); // honour EXIF orientation
    if (longEdge > TARGET_LONG_EDGE && longEdge > 0) {
      if (w >= h) {
        pipeline = pipeline.resize({ width: TARGET_LONG_EDGE, fit: "inside" });
      } else {
        pipeline = pipeline.resize({ height: TARGET_LONG_EDGE, fit: "inside" });
      }
    }
    return await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  } catch (err) {
    console.warn(
      `[image-resize] sharp pipeline failed, passing original buffer: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return buffer;
  }
}
