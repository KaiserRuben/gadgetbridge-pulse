/**
 * One-shot migration: scan every daily/<date>/ folder, infer which artifacts
 * are valid + complete, set `incomplete: false` in their JSON payloads, and
 * rebuild `state/completion-log.jsonl` from the result.
 *
 * Heuristics for "complete":
 *   v3 insights — parse + has `schema_version` matching the expected use-case
 *                 prefix + has top-level prose fields (headline OR abstain=true).
 *   v2 daily.json — parse + has `schema_version` starting with `daily/v2` +
 *                   `pipeline_status` in {ok, partial, abstained}.
 *
 * The script is idempotent and runs in O(folders × artifacts).
 *
 * Invoke: `tsx src/index.ts backfill-completion`
 */

import { readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

import { config } from "../config.ts";
import { rewriteLog, type Artifact } from "../state/completion-log.ts";

interface ArtifactDef {
  artifact: Artifact;
  file: string;
  isComplete: (payload: Record<string, unknown>) => boolean;
}

const hasHeadlineOrAbstain = (obj: Record<string, unknown>): boolean =>
  obj.abstain === true || (typeof obj.headline === "string" && obj.headline.trim().length > 0);

const schemaStartsWith = (obj: Record<string, unknown>, prefix: string): boolean =>
  typeof obj.schema_version === "string" && (obj.schema_version as string).startsWith(prefix);

const v3Def = (artifact: Artifact, file: string, schemaPrefix: string): ArtifactDef => ({
  artifact,
  file,
  isComplete: (obj) => schemaStartsWith(obj, schemaPrefix) && hasHeadlineOrAbstain(obj),
});

const ARTIFACT_DEFS: readonly ArtifactDef[] = [
  { artifact: "v2_daily", file: "daily.json", isComplete: (obj) => schemaStartsWith(obj, "daily/v2") && hasHeadlineOrAbstain(obj) },
  v3Def("v3_sleep", "sleep_insight.json", "use_case/sleep/"),
  v3Def("v3_recovery", "recovery_insight.json", "use_case/recovery/"),
  v3Def("v3_activity", "activity_insight.json", "use_case/activity/"),
  v3Def("v3_synthesis", "daily_v3.json", "use_case/synthesis/"),
];

const listDailyDates = (): string[] => {
  try {
    return readdirSync(path.join(config.insightsRoot, "daily"))
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
      .sort();
  } catch {
    return [];
  }
};

const readJsonObject = (p: string): Record<string, unknown> | null => {
  try {
    const raw = readFileSync(p, "utf8");
    if (raw.length < 3) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const flipAndPersist = (p: string, payload: Record<string, unknown>): boolean => {
  if (payload.incomplete === false) return false;
  payload.incomplete = false;
  const tmp = `${p}.bf.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tmp, p);
  return true;
};

const dates = listDailyDates();
const root = path.join(config.insightsRoot, "daily");

const hits = dates.flatMap((periodKey) =>
  ARTIFACT_DEFS.map((def) => {
    const file = path.join(root, periodKey, def.file);
    const payload = readJsonObject(file);
    const complete = !!payload && def.isComplete(payload);
    return { periodKey, def, file, payload, complete };
  }),
);

const completed = hits.filter((h) => h.complete);
const flipped = completed.filter((h) => flipAndPersist(h.file, h.payload!)).length;
const entries = completed.map((h) => ({ ts: new Date().toISOString(), periodKey: h.periodKey, artifact: h.def.artifact }));

rewriteLog(entries);
console.log(
  `backfill complete: ${entries.length} log entries written, ` +
    `${flipped} files flipped to incomplete=false, ` +
    `${hits.length} artifacts scanned`,
);
