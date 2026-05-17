import { redirect } from "next/navigation";

import { getLatestDailyDate } from "@/lib/insights";
import { todayKey } from "@/lib/time";

/**
 * Legacy `/day` (no date) → resolves the latest finalised day and forwards
 * to the unified home route at `/?d=…`. Kept as a thin redirect so the
 * historical `/day/today` semantics survive.
 */
export default async function DayIndexRedirect() {
  const latest = (await getLatestDailyDate()) ?? todayKey();
  redirect(`/?d=${latest}`);
}
