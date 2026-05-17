"use server";

import { writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { loadAlarms, getCurrentMonthKey } from "@/lib/insights";
import type { AlarmsV2 } from "@/lib/types/generated";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export type ClearResult =
  | { ok: true; dismissed: number }
  | { ok: false; error: string };

/**
 * Mark every active (un-dismissed) alarm in the given month-bucket as dismissed.
 * Active here matches the alarms-page definition: not yet `ev.dismissed`.
 * Snoozed/muted entries are flipped too — the user explicitly asked for a clean
 * slate.
 */
export async function clearAllAlarms(monthKey?: string): Promise<ClearResult> {
  const key = monthKey ?? getCurrentMonthKey();
  const alarms = await loadAlarms(key);
  if (!alarms || alarms.events.length === 0) {
    return { ok: true, dismissed: 0 };
  }
  const nowIso = new Date().toISOString();
  let count = 0;
  const next: AlarmsV2 = {
    ...alarms,
    events: alarms.events.map((ev) => {
      if (ev.dismissed) return ev;
      count += 1;
      return {
        ...ev,
        dismissed: true,
        dismissed_at: nowIso,
        dismissed_reason: "user_clear_all",
      };
    }),
  };
  try {
    const filePath = path.join(INSIGHTS_ROOT, "alarms", key, "alarms.json");
    await atomicWriteJson(filePath, next);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
  revalidatePath("/alarms");
  revalidatePath("/", "layout");
  return { ok: true, dismissed: count };
}
