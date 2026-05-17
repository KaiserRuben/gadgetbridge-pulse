import "server-only";
import { redirect } from "next/navigation";
import { getCurrentWeekKey } from "@/lib/insights";

export default function WeekIndex() {
  redirect(`/week/${getCurrentWeekKey()}`);
}
