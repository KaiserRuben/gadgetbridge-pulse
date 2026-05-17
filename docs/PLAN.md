# Pulse — initial design plan

> **Scope note (2026-05-10)** — historical design doc from project bootstrap.
> The IA, file tree, and out-of-scope sections below describe the v1 vision;
> the live route map has since expanded substantially. For the current state
> see `app/(app)/` (sleep, activity, heart, body, stress, day, week, coach,
> activities, workouts, alarms, labs, log, profile, explore) and
> `COACH_PLAN.md` for the runner pipeline. The design language section is
> still current.

A dribbble-worthy, modern, intuitive dashboard over a Gadgetbridge SQLite export.
Built read-only; the DB is the source of truth.

## Stack

- **Next.js 15** App Router, RSC streaming, TypeScript, React 19
- **Tailwind CSS v4** (CSS-first config, oxide engine)
- **motion** (`motion/react`) — physics-based animation, layout transitions
- **Recharts** — line / area / bar / radial composites
- Custom **SVG** for hypnogram, ring gauges, heatmap, hero visuals
- **lucide-react** — icon set
- **next-themes** — dark default, light option
- **better-sqlite3** — server-side read of `$PULSE_ROOT/Gadgetbridge.db`
- **Radix primitives** — tooltip, dialog, tabs (unstyled, theme-driven)
- **clsx + tailwind-merge + cva** — class composition
- **Geist Sans / Geist Mono** — display + tabular numerals

## User stories

| As… | I want… | So I can… |
|---|---|---|
| Health-curious wearer | a one-glance hero today screen | feel the day at a single look |
| Sleep optimizer | hypnogram + score breakdown | judge whether tonight was good |
| Activity tracker | step / calorie / distance over the day | see effort vs goal |
| HR watcher | continuous HR with anomalies marked | spot weird beats |
| Body sensor | skin-temp + SpO₂ + stress curves | catch trends |
| Device owner | profile + device + sync status | trust the data origin |

## Information architecture

Original v1 design (kept for context):

```
/             → redirect /today
/today        Hero glance, all domains skim
/sleep        Hypnogram, stages, sleep biometrics, apnea
/activity     Steps, calories, distance, hourly grid, workout markers
/heart        HR timeline, zones, RHR, HRV
/body         Temperature, SpO₂, stress
/profile      User, device, battery, alarms, calendar, anomaly report
```

Live IA today (`app/(app)/`):

```
/                       landing (home), verdict + drivers + day-tile grid
/day, /day/[date]       day detail + DateStrip nav
/week, /week/[weekKey]  weekly recap (Stage W output)
/coach                  trajectories, levers, pattern library
/sleep, /activity, /heart, /body, /stress  (+ /[date] variants)  domain pages
/activities, /activities/[id]              activity log
/workouts, /workouts/[id]                  workout detail
/alarms                                    alarm management
/explore, /explore/[metric]                exploratory chart playground
/log/{journal,weight,feel,screenshot,…}    manual input
/labs                                      experimental toggle panel
/profile                                   user, device, baseline, sync
```

Sidebar (md+): rail with icon + label, active pill animates with `layoutId`.
Topbar: date label, sync indicator (live battery %), theme toggle, profile chip.
Mobile: bottom tab bar (5 icons + more sheet).

## Design language

### Color (HSL tokens, dark first)
- `--bg`: deep neutral 240 6% 6%
- `--surface`: 240 6% 8% / glass overlay
- `--border`: 240 4% 14%
- `--text`: 0 0% 96%
- `--muted`: 240 4% 60%
- Domain accents:
  - Sleep: indigo→violet (#6366f1 → #a855f7)
  - Activity: emerald→lime (#10b981 → #84cc16)
  - Heart: rose→red (#f43f5e → #ef4444)
  - Body: amber→cyan (skin-temp warm, SpO₂ cool)
  - Stress: orange→amber (#f97316 → #f59e0b)

### Type scale
- Display 72/64/48 (numerals, tabular, tracking-tighter)
- Title 24/20
- Body 14/13
- Mono caption for timestamps/units

### Cards
- 1px hairline border, 16–24 px radius, subtle inner highlight
- Hover: lift 2 px, gradient border on hover via mask
- Section headers small-caps mono accent

### Motion
- Page enter: fade+rise (12 px, 240 ms, easeOut)
- Card stagger: 40 ms gap
- Charts: stroke-dasharray draw-in, 800 ms
- Number tickers spring (stiffness 80, damping 18)
- Sidebar pill `layoutId` transition

### Psychology levers
- **Hero anchor** — single big number commands attention (sleep score 83)
- **Recognition over recall** — color-coded domains across all pages
- **Progressive disclosure** — KPI → expand → detail chart
- **Loss aversion / anomaly callout** — yellow soft warning, never red panic
- **Goal proximity** — step ring proximity reading (4.2% of 10k → "first km of the day")
- **Tactile feedback** — every hover/tap returns motion
- **Whitespace as luxury cue** — never crowd

## Data layer

```
lib/
  db.ts                 better-sqlite3 singleton (read-only, WAL off)
  queries/
    activity.ts         steps/cal/dist/HR/SpO2 minute series + aggregates
    sleep.ts            stage timeline + stats + apnea
    biometrics.ts       temperature, HRV, stress
    profile.ts          user, device, battery, alarms, calendar
    summary.ts          today-page composite (one round-trip)
  types.ts              SampleRow, SleepBlock, etc.
  time.ts               UTC↔local (Europe/Berlin)
  format.ts             number formatters, units
  anomalies.ts          detect HR=-125, sentinel steps, etc
  constants.ts          stage labels, stress buckets, colors
```

All queries server-side in RSCs. Pages stream via `<Suspense>`.

## File tree

```
pulse/
  PLAN.md                          (this file)
  README.md
  package.json
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  app/
    globals.css                    Tailwind v4 + tokens
    layout.tsx                     fonts, theme provider, root
    page.tsx                       redirect → /today
    (dashboard)/
      layout.tsx                   sidebar + topbar shell
      today/page.tsx
      sleep/page.tsx
      activity/page.tsx
      heart/page.tsx
      body/page.tsx
      profile/page.tsx
  components/
    ui/
      card.tsx surface.tsx button.tsx badge.tsx
      ring-gauge.tsx number-ticker.tsx sparkline.tsx
      kpi-tile.tsx section-heading.tsx
      tooltip.tsx empty-state.tsx
      anomaly-pill.tsx
    layout/
      sidebar.tsx topbar.tsx mobile-nav.tsx
      theme-toggle.tsx
    charts/
      hr-timeline.tsx              recharts LineChart with sleep-window band
      hypnogram.tsx                custom SVG blocks, motion stagger
      stage-donut.tsx              recharts PieChart with custom labels
      stress-timeline.tsx          area + bucket bands
      temperature-curve.tsx        smoothed area
      spo2-distribution.tsx        histogram
      hrv-scatter.tsx              points + trend line
      steps-heatmap.tsx            16×60 grid of minute cells
      battery-timeline.tsx         step-line
      breath-gauge.tsx
    sections/
      today/hero-sleep.tsx today/kpi-row.tsx today/anomalies.tsx
      sleep/* activity/* heart/* body/* profile/*
    motion/
      fade-up.tsx stagger.tsx page-transition.tsx
  lib/
    db.ts queries/ types.ts time.ts format.ts anomalies.ts constants.ts cn.ts
  public/
    (no asset commitment, use SVG inline)
```

## Build phases

1. **Scaffold** — package.json, configs, install
2. **Foundations** — tokens, globals.css, fonts, theme provider, cn util
3. **Data layer** — db.ts + queries/* with strict types
4. **Shell** — sidebar, topbar, mobile-nav, page-transition wrapper
5. **Primitives** — card, ring-gauge, number-ticker, kpi-tile, anomaly-pill
6. **Charts** — hypnogram first (anchor of the design), then hr-timeline, then the rest
7. **Pages** — today (composite) → sleep → heart → body → activity → profile
8. **Polish** — empty states, error boundaries, micro-animations, hover feedback
9. **Verify** — `npm run dev`, click every route

## Out of scope (for v1)

- Editing or syncing back to the watch
- ~~Multi-day comparison~~ — shipped (multi-day windows + week/coach/year aggregates)
- Auth / multi-user
- Export / PDF report
- ~~Workout deep-dive~~ — shipped at `/workouts` + `/workouts/[id]`
