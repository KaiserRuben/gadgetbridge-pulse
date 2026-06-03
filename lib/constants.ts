/**
 * Domain constants. Single source of truth for labels, colors, code mappings.
 * Color values mirror tokens in app/globals.css (hard-coded so charts can use them).
 */

/** Huawei sleep stage codes (verified against source). */
export const SLEEP_STAGE = {
  1: { label: "Light", color: "hsl(220 65% 60%)" },
  2: { label: "REM", color: "hsl(280 75% 64%)" },
  3: { label: "Deep", color: "hsl(252 80% 56%)" },
  4: { label: "Awake", color: "hsl(28 80% 58%)" },
} as const;

export type SleepStageCode = keyof typeof SLEEP_STAGE;

/** Stress bucket bands per Huawei convention (1–29 / 30–59 / 60–79 / 80–100). */
export const STRESS_BUCKETS = [
  { min: 0, max: 29, label: "Relaxed", color: "hsl(150 70% 52%)" },
  { min: 30, max: 59, label: "Mild", color: "hsl(45 92% 60%)" },
  { min: 60, max: 79, label: "Moderate", color: "hsl(28 92% 58%)" },
  { min: 80, max: 100, label: "High", color: "hsl(0 84% 60%)" },
] as const;

export function stressBucket(stress: number) {
  return STRESS_BUCKETS.find((b) => stress >= b.min && stress <= b.max) ?? STRESS_BUCKETS[0];
}

export const HR_ZONES = [
  { min: 0, max: 90, label: "Rest", color: "hsl(195 80% 60%)" },
  { min: 90, max: 110, label: "Easy", color: "hsl(150 70% 52%)" },
  { min: 110, max: 130, label: "Aerobic", color: "hsl(45 92% 60%)" },
  { min: 130, max: 150, label: "Threshold", color: "hsl(28 92% 58%)" },
  { min: 150, max: 220, label: "Max", color: "hsl(348 90% 60%)" },
] as const;

export function hrZone(bpm: number) {
  return HR_ZONES.find((z) => bpm >= z.min && bpm < z.max) ?? HR_ZONES[0];
}

// ── v5 nav: domain-first routes ────────────────────────────────────────────
//
// Active-state matching is done via regex match against the pathname. The
// `match` regex is the source of truth for "should this nav item highlight".
// Examples:
//   `/sleep`         matches Sleep (`^/sleep(/|$)`)
//   `/sleep/2026-05-08` also matches Sleep
//   `/`              matches Home only on exact match
//   `/day`/`/day/X`  matches Day
//
// The nav items remain plain `as const` tuples so consumers can iterate
// without losing the icon-key constraint.

export type NavItem = {
  /** Anchor href used for the link. */
  href: string;
  /** German label. */
  label: string;
  /** Lucide icon key, resolved by the consumer to a component. */
  icon: string;
  /**
   * Pathname matcher source. Compiled at the edge of consumers so that the
   * regex isn't re-instantiated per render. Keep `^` and trailing `(/|$)` for
   * sane prefix matching, or `^/$` for exact root.
   */
  match: string;
};

export type NavSection = {
  /** Optional eyebrow label printed above the group on desktop. */
  label: string | null;
  items: readonly NavItem[];
};

/**
 * Mobile primary bottom-nav. Five fast-access slots (Phase U4):
 *   Home (`/`)        — unified today + day-detail (via `?d=…`).
 *   Schlaf (`/sleep`) — sleep domain page.
 *   Training (`/training`) — active plan-and-session surface.
 *   Coach (`/coach`)  — morning-briefing levers (fires on `sleep_complete`).
 *   Ernährung (`/nutrition`) — nutrition log (tool-calling pipeline lands in Phase 3e).
 *
 * Day legacy (`/day` and `/day/<date>`) 301-redirects into `/?d=…`. The
 * old "More" drawer trigger moved into the topbar (gear icon → /settings).
 * Secondary domain surfaces stay reachable via the desktop sidebar or
 * the topbar settings page. On viewports without a sidebar (mobile), the
 * sheet still opens via the persistent ⋯ slot in the bottom nav.
 */
export const NAV_PRIMARY_MOBILE: readonly NavItem[] = [
  { href: "/v4", label: "Home", icon: "Home", match: "^/(v4)?(\\?|$)" },
  { href: "/training", label: "Training", icon: "Dumbbell", match: "^/training(/|$)" },
  { href: "/coach", label: "Coach", icon: "Brain", match: "^/coach(/|$)" },
  { href: "/nutrition", label: "Ernährung", icon: "Utensils", match: "^/nutrition(/|$)" },
  { href: "/week", label: "Woche", icon: "CalendarRange", match: "^/week(/|$)" },
] as const;

/**
 * Mobile More-sheet items (sibling to NAV_PRIMARY_MOBILE). Holds every
 * surface that lost its bottom-nav slot to the U4 fast-access lineup —
 * weekly overview, secondary domains, tools, and admin pages.
 */
export const NAV_SHEET_MOBILE: readonly NavItem[] = [
  { href: "/workouts", label: "Workouts", icon: "GitMerge", match: "^/(activities|workouts)(/|$)" },
  { href: "/explore", label: "Explore", icon: "BarChart2", match: "^/explore(/|$)" },
  { href: "/alarms", label: "Alarme", icon: "Bell", match: "^/alarms(/|$)" },
  { href: "/log", label: "Log", icon: "PenLine", match: "^/log(/|$)" },
  { href: "/profile", label: "Profil", icon: "User", match: "^/profile(/|$)" },
  { href: "/settings", label: "Einstellungen", icon: "Settings", match: "^/settings(/|$)" },
  // Legacy per-domain pages (kept reachable while v4 slots stabilise).
  { href: "/sleep", label: "Schlaf (v3)", icon: "Moon", match: "^/sleep(/|$)" },
  { href: "/activity", label: "Bewegung (v3)", icon: "Footprints", match: "^/activity(/|$)" },
  { href: "/heart", label: "Herz (v3)", icon: "HeartPulse", match: "^/heart(/|$)" },
  { href: "/body", label: "Körper (v3)", icon: "Thermometer", match: "^/body(/|$)" },
  { href: "/stress", label: "Stress (v3)", icon: "Waves", match: "^/stress(/|$)" },
] as const;

/**
 * Desktop sidebar (UI/UX rework).
 *
 * Top block: five fast-access surfaces — Home, Coach, Schlaf, Training,
 * Ernährung — same as bottom-nav for muscle memory.
 *
 * Single "Weitere" section holds the rest, flat, no sub-labels. Domain
 * pages are reachable via home KPI tiles too, so the sidebar doesn't
 * need to re-advertise them per-section. Settings + admin live in the
 * topbar gear icon.
 */
export const NAV_DESKTOP_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    items: [
      { href: "/v4", label: "Home", icon: "Home", match: "^/(v4)?(\\?|$)" },
      { href: "/coach", label: "Coach", icon: "Brain", match: "^/coach(/|$)" },
      { href: "/training", label: "Training", icon: "Dumbbell", match: "^/training(/|$)" },
      { href: "/nutrition", label: "Ernährung", icon: "Utensils", match: "^/nutrition(/|$)" },
      { href: "/week", label: "Woche", icon: "CalendarRange", match: "^/week(/|$)" },
    ],
  },
  {
    label: "Weitere",
    items: [
      { href: "/workouts", label: "Workouts", icon: "GitMerge", match: "^/(activities|workouts)(/|$)" },
      { href: "/explore", label: "Explore", icon: "BarChart2", match: "^/explore(/|$)" },
      { href: "/log", label: "Log", icon: "PenLine", match: "^/log(/|$)" },
      { href: "/alarms", label: "Alarme", icon: "Bell", match: "^/alarms(/|$)" },
    ],
  },
  {
    // Legacy per-domain dashboards. Slots in v4 cover the same data; kept
    // reachable while v4 stabilises. Drop this section once Phase 4 lands.
    label: "Legacy",
    items: [
      { href: "/sleep", label: "Schlaf (v3)", icon: "Moon", match: "^/sleep(/|$)" },
      { href: "/activity", label: "Bewegung (v3)", icon: "Footprints", match: "^/activity(/|$)" },
      { href: "/heart", label: "Herz (v3)", icon: "HeartPulse", match: "^/heart(/|$)" },
      { href: "/body", label: "Körper (v3)", icon: "Thermometer", match: "^/body(/|$)" },
      { href: "/stress", label: "Stress (v3)", icon: "Waves", match: "^/stress(/|$)" },
    ],
  },
] as const;

export const TIMEZONE = "Europe/Berlin";

/** Time conversion constants. */
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_YEAR = 365.25 * MS_PER_DAY;
/** Threshold to distinguish ms epochs (>~Sep 2001) from second epochs. */
export const MS_EPOCH_THRESHOLD = 1e12;
