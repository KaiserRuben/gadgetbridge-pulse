import { redirect } from "next/navigation";

import { addDays, todayKey } from "@/lib/time";

/**
 * Legacy day route. The day-detail surface moved into the unified home page
 * at `/?d=YYYY-MM-DD`; this file stays as a 301-shaped redirect so any
 * bookmark, share link, or in-app reference to `/day/<date>` keeps working.
 *
 * `t=<unix-ms>` highlight query is passed through to the unified page.
 */
export default async function DayLegacyRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams?: Promise<{ t?: string }>;
}) {
  const { date } = await params;
  const sp = (await searchParams) ?? {};

  let resolved = date;
  if (date === "today" || date === "heute") resolved = todayKey();
  else if (date === "yesterday" || date === "gestern") resolved = addDays(todayKey(), -1);

  const qs = new URLSearchParams();
  qs.set("d", resolved);
  if (sp.t) qs.set("t", sp.t);
  redirect(`/?${qs.toString()}`);
}
