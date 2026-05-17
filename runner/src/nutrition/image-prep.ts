/**
 * Image preparation for VLM calls.
 *
 * qwen3.6 crashes its model runner under VRAM pressure when multiple
 * full-resolution photos are stacked into one prompt. Shrinking each photo
 * to a long-edge cap before base64-encoding keeps the day-aggregate call
 * stable under strict-schema mode (the only mode where output structure is
 * trustworthy).
 *
 * Per-call call-site choice of `longEdge`:
 *   - per-meal classify (single image): 1024 — preserve portion-estimation detail.
 *   - day-aggregate (multi-image)     :  512 — recognise meal type + colours.
 */

import { readFile } from "node:fs/promises";
import sharp from "sharp";

export interface PreparedImage {
  base64: string;
  bytes: number;
  width: number;
  height: number;
}

/**
 * Resize an on-disk image to `longEdge` pixels (preserving aspect ratio),
 * encode as JPEG (quality 75), and return base64. Accepts JPEG, PNG,
 * WebP, HEIC, HEIF — anything sharp recognises.
 */
export async function prepareImage(
  absPath: string,
  longEdge: number,
): Promise<PreparedImage> {
  const raw = await readFile(absPath);
  const img = sharp(raw, { failOn: "none" });
  const meta = await img.metadata();
  const out = await img
    .rotate()
    .resize({
      width: longEdge,
      height: longEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return {
    base64: out.toString("base64"),
    bytes: out.byteLength,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}
