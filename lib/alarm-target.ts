import type { AlarmEvent } from "@/lib/types/generated";

const DOMAIN_TO_ROUTE: Record<string, string> = {
  cardio: "heart",
  sleep: "sleep",
  activity: "activity",
  body: "body",
  stress: "stress",
};

export function alarmTargetUrl(ev: AlarmEvent): string {
  const segment = DOMAIN_TO_ROUTE[ev.domain] ?? "day";
  const ts = Date.parse(ev.fired_at);
  const t = Number.isFinite(ts) ? `?t=${ts}` : "";
  return `/${segment}/${ev.period_key}${t}`;
}

/**
 * Year 2001 epoch ms (Sep 9 2001 ~ first 13-digit timestamp). Anything below
 * is almost certainly a malformed input — guard so we don't pretend to
 * highlight a 1970 point on charts.
 */
const TS_MIN_MS = 1_000_000_000_000;
/** Year 2100 epoch ms — plenty of headroom for legit health data. */
const TS_MAX_MS = 4_102_444_800_000;

export function parseTimestampParam(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < TS_MIN_MS || n > TS_MAX_MS) return undefined;
  return n;
}
