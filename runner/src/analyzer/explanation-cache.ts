/**
 * Sidecar file cache for anomaly explanations.
 *
 * Path: `${cacheRoot}/explanations/${period_key}_${observation_id}.json`.
 * cacheRoot is the same `insightsRoot` the runner writes daily JSON to, so
 * the cache Syncs to the Pi alongside the daily insights — meaning a
 * pre-computed explanation generated on the Mac is immediately available
 * on the Pi UI without re-invoking Ollama.
 *
 * Atomic write reuses the tmp+rename pattern from output/alarms.ts, with the
 * EXDEV copy+unlink fallback for the staging-directory case (here we stage
 * inside the target directory itself, so EXDEV is not expected — but kept
 * for parity).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { AnomalyExplanation } from "./anomaly-explanation.ts";

function cacheFilePath(observationId: string, periodKey: string, cacheRoot: string): string {
  return path.join(cacheRoot, "explanations", `${periodKey}_${observationId}.json`);
}

export async function readCachedExplanation(
  observationId: string,
  periodKey: string,
  cacheRoot: string,
): Promise<AnomalyExplanation | null> {
  const file = cacheFilePath(observationId, periodKey, cacheRoot);
  try {
    const txt = await readFile(file, "utf8");
    return JSON.parse(txt) as AnomalyExplanation;
  } catch {
    return null;
  }
}

export async function writeCachedExplanation(
  observationId: string,
  periodKey: string,
  explanation: AnomalyExplanation,
  cacheRoot: string,
): Promise<void> {
  const file = cacheFilePath(observationId, periodKey, cacheRoot);
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, `${JSON.stringify(explanation, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
