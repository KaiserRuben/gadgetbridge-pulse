import { redirect } from "next/navigation";
import { getLatestDailyDate } from "@/lib/insights";
import { todayKey } from "@/lib/time";

export default async function StressIndex() {
  const latest = (await getLatestDailyDate()) ?? todayKey();
  redirect(`/stress/${latest}`);
}
