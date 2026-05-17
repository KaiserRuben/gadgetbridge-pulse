/**
 * v2 schema loader.
 *
 * Schemas are read from disk at module-load time using `readFileSync` rather
 * than via JSON import attributes (`import x from "./x.json" with {type:"json"}`)
 * because the `with` syntax has had stability issues in older tsx versions.
 * The runtime cost is paid once at startup.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(name: string): object {
  const p = path.resolve(__dirname, name);
  return JSON.parse(readFileSync(p, "utf8")) as object;
}

export const dailySchema = load("daily.schema.json");
export const factsSchema = load("facts.schema.json");
export const weeklySchema = load("weekly.schema.json");
export const bundleSchema = load("bundle.schema.json");
export const alarmsSchema = load("alarms.schema.json");
export const alarmStateSchema = load("alarm-state.schema.json");
export const labsSchema = load("labs.schema.json");
export const pauseSchema = load("pause.schema.json");
