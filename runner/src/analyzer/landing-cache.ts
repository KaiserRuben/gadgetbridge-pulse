/**
 * Sidecar file cache for landing layouts.
 *
 * Path: `${cacheRoot}/landing/${date}.json`. cacheRoot is the same
 * `insightsRoot` the runner writes daily JSON to, so the cache syncs to the
 * Pi alongside daily insights and a layout pre-computed on the Mac is
 * immediately available on the Pi UI without re-invoking Ollama.
 *
 * Atomic write reuses the tmp+rename pattern from explanation-cache.ts —
 * so a partial write never leaves a half-written JSON readable.
 *
 * TTL: forever per day. Re-running the curator simply overwrites the file
 * (idempotent given the deterministic seed).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { LandingLayout } from "./landing-curator.ts";

function cacheFilePath(date: string, cacheRoot: string): string {
  return path.join(cacheRoot, "landing", `${date}.json`);
}

export async function readCachedLanding(
  date: string,
  cacheRoot: string,
): Promise<LandingLayout | null> {
  const file = cacheFilePath(date, cacheRoot);
  try {
    const txt = await readFile(file, "utf8");
    return JSON.parse(txt) as LandingLayout;
  } catch {
    return null;
  }
}

export async function writeCachedLanding(
  layout: LandingLayout,
  cacheRoot: string,
): Promise<void> {
  const file = cacheFilePath(layout.date, cacheRoot);
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(tmp, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
