"use server";

/**
 * Server actions for the /settings KI-Verhalten section. Writes flow
 * through `writeStateKv` so the same `settings:auto_process` /
 * `settings:critic_model` keys that the runner consumes via
 * `runner/src/jobs/settings.ts` are kept in lock-step.
 *
 * Sync read helpers live in `_data.ts` because every export from a
 * `"use server"` module is treated as a server action by Next.js.
 */

import { revalidatePath } from "next/cache";

import { writeStateKv } from "@/lib/data/period-store";

import type { AutoProcessKv, CriticKv } from "./_data";

export async function setAutoProcessGlobal(enabled: boolean): Promise<void> {
  writeStateKv("settings:auto_process", { enabled } satisfies AutoProcessKv);
  revalidatePath("/settings");
  revalidatePath("/settings/clusters");
}

export async function setCriticEnabled(enabled: boolean): Promise<void> {
  writeStateKv("settings:critic_model", { enabled } satisfies CriticKv);
  revalidatePath("/settings");
}

export async function setAutoProcessForCluster(
  cluster: string,
  override: "inherit" | "on" | "off",
): Promise<void> {
  const key = `settings:auto_process:${cluster}`;
  if (override === "inherit") {
    // Clear the per-cluster row by writing null. The runner's settings
    // helper treats anything other than a strict {enabled: bool} as
    // missing → falls back to global.
    writeStateKv(key, null);
  } else {
    writeStateKv(key, {
      enabled: override === "on",
    } satisfies AutoProcessKv);
  }
  revalidatePath("/settings/clusters");
}
