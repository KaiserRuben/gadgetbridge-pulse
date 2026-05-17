import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ??
  "./pulse/insights";

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

export type Bundle = {
  runs: RunRecord[];
  updated_at: string;
  validated_with?: string;
};

export type PeriodBundle = {
  timeframe: string;
  period_key: string;
  bundle: Bundle;
};

/** List all `_bundle.json` files under insights/, freshest first. */
export async function listBundles(): Promise<PeriodBundle[]> {
  const out: PeriodBundle[] = [];
  for (const tf of ["snapshot", "week", "month", "year", "lifetime"]) {
    const tfDir = path.join(INSIGHTS_ROOT, tf);
    let periods: string[] = [];
    try {
      periods = await readdir(tfDir);
    } catch {
      continue;
    }
    for (const p of periods) {
      const bundlePath = path.join(tfDir, p, "_bundle.json");
      try {
        const s = await stat(bundlePath);
        if (!s.isFile()) continue;
        const txt = await readFile(bundlePath, "utf8");
        out.push({ timeframe: tf, period_key: p, bundle: JSON.parse(txt) });
      } catch {
        /* missing bundle, skip */
      }
    }
  }
  return out.sort((a, b) =>
    (b.bundle.updated_at ?? "").localeCompare(a.bundle.updated_at ?? ""),
  );
}
