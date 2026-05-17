/**
 * Atomic output writer. tmp + rename so Syncthing never picks up half-written.
 */

import { mkdir, rename, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.ts";

export async function writeAtomic(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

export function periodDir(timeframe: string, periodKey: string): string {
  return path.join(config.insightsRoot, timeframe, periodKey);
}

export function insightPath(timeframe: string, periodKey: string, domain: string) {
  return path.join(periodDir(timeframe, periodKey), `${domain}.json`);
}

export type RunRecord = {
  domain: string;
  timeframe: string;
  attempts: number;
  duration_ms: number;
  prompt_tokens: number;
  eval_tokens: number;
  validated: boolean;
  reason?: string;
  confidence?: number;
};

export const SCHEMA_VERSION = "v2" as const;

export async function appendBundle(timeframe: string, periodKey: string, run: RunRecord) {
  const p = path.join(periodDir(timeframe, periodKey), "_bundle.json");
  let bundle: {
    runs: RunRecord[];
    updated_at: string;
    validated_with: string;
  } = {
    runs: [],
    updated_at: new Date().toISOString(),
    validated_with: SCHEMA_VERSION,
  };
  try {
    await stat(p);
    const txt = await readFile(p, "utf8");
    bundle = { ...bundle, ...JSON.parse(txt) };
  } catch {
    /* first write */
  }
  bundle.runs = bundle.runs.filter((r) => r.domain !== run.domain);
  bundle.runs.push(run);
  bundle.updated_at = new Date().toISOString();
  bundle.validated_with = SCHEMA_VERSION;
  await writeAtomic(p, JSON.stringify(bundle, null, 2));
}
