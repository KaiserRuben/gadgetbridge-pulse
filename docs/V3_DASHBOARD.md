# Pulse V3 Dashboard — Design Doc

> Status: design complete. Reference for Phase 5 implementation.

## Executive summary

Greenfield rework of the dashboard around the v3 use-case pipeline (sleep, recovery, activity, synthesis). Goals: data-rich, smart-actionable, mode-aware, drill-down friendly, mobile-first. Backed by Pi (controller, DB, runner, scheduler, push dispatcher) ↔ Mac (Ollama). Live UI progress via WebSocket. Web Push (PWA) for actionable notifications. Three smart triggers (post-workout, morning wake, evening wind-down) augment the nightly batch.

Hero stops showing "confidence as score" (the v2 confusion). New hero: deterministic `day_score` (0-100) in the ring, `verdict_band` as semantic tag, `headline` as user-facing answer, `summary_short`/`summary_long` for mobile/desktop. Domain pointers below hero. Cross-domain `key_insight` and `top_action_today` surface the non-obvious connection and the single best move.

Companion docs:
- [V2_PIPELINE.md] (existing) — what we're replacing
- Memory: `project_v3_use_case_pattern.md` — LLM call pattern
- Memory: `project_v3_topology.md` — Pi/Mac/browser deployment

## Table of contents

- [4.1 User-needs brainstorm](#41-user-needs-brainstorm)
- [4.2 Page architecture](#42-page-architecture)
- [4.3 Dynamic state model](#43-dynamic-state-model)
- [4.4 Density principles](#44-density-principles)
- [4.5 Mockups — Home dashboard (4 modes)](#45-mockups--home-dashboard-4-modes)
- [4.6 Mockup — Day detail page](#46-mockup--day-detail-page)
- [4.7 Mockups — Drill-down pages](#47-mockups--drill-down-pages)
- [4.8 Component inventory + map](#48-component-inventory--map)
- [4.10 Push setup](#410-push-setup)
- [Phase 5 implementation order](#phase-5-implementation-order)

---


## 4.1 User-needs brainstorm

### User profile

Single-user app. Builder/engineer, German UI, technically literate. Wears a Huawei wristband 24/7, generates ~24h of biometric data per day. Accesses dashboard from desktop (work hours) + mobile (everywhere else). Cares about: training optimization, recovery quality, sleep, day-readiness. Wants smart actionable insights, not raw data dumps.

### Reading depths

Every page must answer at three depths:

| Depth | Time | What user wants |
|---|---|---|
| **1-second glance** | mid-task, walking past | One color + one number + one word |
| **5-second scan** | "how am I doing?" | Verdict + headline + top 1-2 numbers |
| **30-second read** | dedicated check | Full insight with reasoning + drill-down hooks |

### Time-of-day moments

| Moment | Hours | Primary question | Hero focus |
|---|---|---|---|
| Morning | 06–10 | "How was last night? Am I ready?" | Sleep verdict + recovery readiness + tonight's plan |
| Midday | 11–15 | "Activity progress? Any signal?" | Steps progress + stress + lunch-window action |
| Post-workout | T+0 to T+90min | "How was that? Recovery cost?" | Workout card + training_quality + recovery_demand + next window |
| Evening | 18–22 | "How was the day? Tomorrow plan?" | day_score + key_insight + tonight's anchor |
| Night | 22–06 | "What's quiet here?" | Minimal: tomorrow's forecast + sleep target |

### Day-of-week shifts

- **Weekday**: time-pressured. Surface "ready for today" + "fit this in" actions.
- **Weekend**: exploratory. Surface weekly trends + experimentation hooks ("try X this week"). De-emphasize urgency.

### Curiosity drivers (sparks drill-down)

What makes user want to dig deeper:
- Color/band mismatch with expectation (low KPI on a "good" day → "why?")
- Surprising number (RMSSD halved overnight → "what changed?")
- Pattern hint ("3rd day low recovery — pattern emerging")
- Comparison to recent ("worst sleep this week", "highest load this month")
- Cross-domain hint from `key_insight` ("training drove poor sleep")

### Curiosity killers (avoid)

- Generic bare numbers without context ("HR 125 bpm" without what user was doing)
- Buried verdicts (need to scroll/click to find the answer)
- Static UI (same content even when nothing changed → boring)
- Wall of text without visual hierarchy
- Mobile truncation that cuts the explanation

### Drill-down expectations

When user clicks into a domain (sleep / recovery / activity), they expect:
1. The full prose insight (analysis_today + analysis_context, no truncation)
2. The KPIs with their reasoning visible
3. Visual time-series (hypnogram, HRV trend, hourly steps, HR-during-sleep)
4. Longitudinal trend (last 7-30 days of the same KPI)
5. The suggestions from that domain (today + long_term)
6. Back-link to home + cross-link to related domains

## 4.2 Page architecture

### Topology

```
Browser ──(HTTPS + WSS)──► Pi (Next.js, runner, scheduler, push dispatcher)
                              │
                              ▼ HTTP (Ollama API)
                          Mac (qwen3.6:latest)
```

Pi owns: pages + API + WebSocket broker + scheduler + push dispatch + DB reads (Syncthing-mirrored Gadgetbridge.db + pulse.db) + insight artifacts (insights/daily/<date>/*).

### URL structure

| Path | Purpose | Render mode |
|---|---|---|
| `/` | Home — today's hero + drill-down launchpads (dynamic by mode) | server (insight) + client (mode + WS) |
| `/day/[date]` | Full day detail — sections per domain | server |
| `/week/[weekKey]` | Weekly recap | server |
| `/sleep/[date]` | Sleep drill-down — hypnogram, stages, HR-during-sleep, RMSSD trend, longitudinal | server + client (charts) |
| `/recovery/[date]` | Recovery drill-down — HRV series, RHR drift, stress timeline, longitudinal | server + client |
| `/activity/[date]` | Activity drill-down — workouts list, hourly steps, HR zones, weekly load | server + client |
| `/explore` | Historical exploration (kept from v2) | client |
| `/settings` | Notification opt-in + preferences | client |

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/insights/[date]/daily` | Returns daily_v3.json |
| GET | `/api/insights/[date]/sleep` | Returns sleep_insight.json |
| GET | `/api/insights/[date]/recovery` | Returns recovery_insight.json |
| GET | `/api/insights/[date]/activity` | Returns activity_insight.json |
| GET | `/api/insights/[date]/package/sleep` | Returns sleep_package.json (for raw chart data) |
| GET | `/api/insights/[date]/package/recovery` | Returns recovery_package.json |
| GET | `/api/insights/[date]/package/activity` | Returns activity_package.json |
| GET | `/api/insights/[date]/day_score` | Returns day_score.json |
| GET | `/api/run/[date]/status` | Current run state (fallback poll) |
| POST | `/api/run/[date]` | Trigger v3 run on demand |
| GET | `/api/run/[date]/stream` (SSE fallback) | Server-sent events for run progress |
| POST | `/api/push/subscribe` | Register web push subscription |
| POST | `/api/push/unsubscribe` | Remove subscription |
| POST | `/api/push/test` | Send test push |

### WebSocket channels

| Path | Subscribed events |
|---|---|
| `/ws/run/[date]` | `stage:start`, `stage:done`, `insight:ready`, `synthesis:ready`, `error` per use case |
| `/ws/today` | `verdict_changed`, `kpi_updated`, `top_action_changed`, `freshly_arrived` (workout, wake) |

UI subscribes to `/ws/today` on home page mount; subscribes to `/ws/run/[date]` when a run is triggered.

### PWA

- `manifest.json`: name "Pulse", icons, theme color (dark by default), `display: standalone`
- Service worker (`/sw.js`): push handler + offline shell cache (HTML + critical CSS + insight cache)
- Install prompt: show on `/settings` with explanation
- Offline read: last-fetched daily_v3.json cached, served from SW when offline

### Navigation

- Top nav (mobile bottom, desktop top): Home / Day / Week / Sleep / Recovery / Activity / Explore
- Cmd-K (existing): search by date, jump to drill-down (e.g. "sleep 2026-05-09" → /sleep/2026-05-09)
- Breadcrumbs on drill-down pages: Home > Sleep > 2026-05-09
- Cross-links from drill-down: each domain card has "Recovery beeinflusst diese Nacht →" link to recovery page same date
- Home cards: tap → drill-down page same date

### Render strategy (per stock-dashboard pattern)

- Home + day pages: server-rendered (read insight JSON directly), client hydrates for WS + mode engine
- Drill-down pages: server-rendered insight, client-rendered charts
- Settings: client-only (push subscription state)

## 4.3 Dynamic state model

### Inputs to the mode engine

Pure function `(now, facts, insights, recentEvents) → DashboardMode`:
- `now` — local time + day-of-week + hours since last refresh
- `facts.last_workout_end_iso` — most recent BASE_ACTIVITY_SUMMARY.END_TIME
- `facts.last_wake_iso` — today's HUAWEI_SLEEP_STATS_SAMPLE.WAKEUP_TIME if present
- `insights.sleep_ready` / `recovery_ready` / `activity_ready` / `synthesis_ready` — file-mtime checks
- `events.recent_push_topic` — last push topic dispatched (avoid duplicate UI emphasis)
- `state.day_complete` — whether today's nightly run completed yet

### Modes (mutually exclusive)

| Mode | Trigger | Hero focus | Sections shown |
|---|---|---|---|
| `night` | 00:00–06:00, no fresh wake yet | Quiet "schlaf gut" + tomorrow forecast | Minimal: tomorrow target, maybe 1 long-trend card |
| `morning-fresh` | wake within 2h, sleep_insight ready | Sleep verdict + recovery_readiness + tonight plan | Sleep card prominent, recovery card, activity preview |
| `morning-stale` | wake within 2h, run in progress | "Analyse läuft …" with live WS progress | Stage progress (sleep ✓ → recovery → activity), packages-derived numbers below |
| `midday` | 10:00–15:00, no fresh workout | Activity progress + stress + lunch action | Steps progress ring, stress timeline today, recovery state |
| `post-workout` | workout end within 90min | Workout card + training_quality + recovery_demand + next-window | Workout summary big, recovery_demand KPI, "next training in X h" |
| `evening` | 18:00–22:00, day data substantial | day_score + key_insight + tonight anchor | Synthesis hero, contradictions if any, tomorrow plan teaser |
| `late-night` | 22:00–00:00 | Wind-down + sleep target | Sleep target time, RHR baseline, very minimal |
| `day-incomplete` | LLM outputs missing, fallback | Deterministic day_score + packages summary | Packages-derived metrics, "vollständige Analyse heute Nacht" hint |

### Mode priority (when multiple match)

```
post-workout (within 90min)
    ↑ always wins
morning-fresh > morning-stale > midday
late-night > evening
day-incomplete (fallback)
```

### Visual treatment per mode

Each mode shifts:
- Accent color (calm blue for night, warm peach for morning, vivid orange post-workout, deep amber evening)
- Card density (sparse for night, dense for evening)
- Animation (subtle pulse on freshly-arrived data)

### Trigger sources (server-side)

| Trigger | Source | Action |
|---|---|---|
| Nightly 03:00 cron | Pi `cron` | Full v3 run for previous local day; push if verdict_band shift |
| Morning poller (every 5 min, 04:00–11:00) | Pi `cron` + db check | New HUAWEI_SLEEP_STATS_SAMPLE with WAKEUP_TIME today → re-run sleep + recovery; push to user |
| Workout poller (every 5 min) | Pi `cron` + db check | New BASE_ACTIVITY_SUMMARY row → re-run activity + synthesis; push to user |
| Evening 21:00 cron | Pi `cron` | Re-run synthesis with day-so-far; push tonight action |
| User-triggered | UI POST `/api/run/[date]` | Force re-run for inspection / debug |

### Push notification topics (web push)

| Topic | Trigger | Body example |
|---|---|---|
| `morning_recap` | Sleep insight ready after wake | "Schlaf 78/100 · RMSSD niedrig — heute leichter Tag" |
| `post_workout` | Activity+synthesis ready after workout | "Lauf 32min · Recovery-Demand hoch — 16h Pause empfohlen" |
| `evening_brief` | Evening synthesis ready | "Tag 44/100 · heute Abend früh schlafen" |
| `verdict_shift` | day_score moved ≥1 band vs yesterday | "Heute klar besser als gestern — RHR -4 bpm" |
| `contradiction` | Synthesis contradictions[] non-empty | "Heute Konflikt: Schlaf vs Training — Schlaf gewinnt" |

Push payload includes deep-link path so OS taps open the right page.

### Freshly-arrived emphasis

When new data lands (workout end, wake event, synthesis ready), the relevant card gets:
- Subtle pulse animation for ~10 seconds
- "neu" badge for the next 2 hours
- Boosted in mode-priority calculation
- One push notification (deduplicated per topic per day)

## 4.4 Density principles

### Information per pixel

Maximize useful data per screen without clutter. Anti-pattern: huge whitespace + 1 number. Pattern: dense card with primary number + baseline range + delta + sparkline + drill-affordance.

### Visual hierarchy levels

| Level | Use | Treatment |
|---|---|---|
| Hero | The headline of the page | Largest type, color band, ring/score visualization |
| Primary | Top KPIs (3 per domain) | Card with value + label + delta + tap target |
| Supporting | Context numbers, baselines, deltas | Inline within primary cards, smaller type |
| Detail | Time series, segments, raw events | Drill-down page only, never on home |

### Number-with-context principle

Every number on screen must include either:
- Personal baseline range (median ± MAD) shown inline → "RHR 58 (norm 56–62)"
- Delta vs baseline → "TST 6h12 (-44 min)"
- Delta vs yesterday → "Steps 8.4k (gestern 12.1k)"
- Workout context for HR spikes → "HR-Max 178 — Lauf 14:30"

Bare numbers without context are forbidden. If you can't supply context, drop the number.

### Drill-down affordances

Every card that has a drill-down page:
- Whole card is tap target (not just a chevron)
- Hover state on desktop: subtle background lift + arrow appearance
- Visited state: faint highlight to remember "I saw this already today"
- Cross-link to related domain: small footer line "Beeinflusst von Training →"

### Anti-patterns

- Empty space without purpose
- Decorative graphics without data
- "Loading..." spinners on what should be cached/server-rendered
- Identical content day-after-day (use mode + freshness + comparisons to keep alive)
- Modals that hide context (prefer slide-out drawer with home still visible)

### Mobile vs desktop

| Attribute | Mobile | Desktop |
|---|---|---|
| Hero ring | 96px | 180px |
| Layout | Stacked single column | 2-3 column grid |
| Summary text | summary_short (≤100 chars) | summary_long (≤200 chars) |
| Drivers | Top 1 inline + "2 mehr" expandable | Top 3 always visible |
| Coach action | Compact card | Card + reasoning expandable |
| Timeline charts | Horizontal scroll with snap points | Full-width inline |
| Cross-links | Footer chips, scrollable | Sidebar related-cards |

### Color + band semantics

Three bands map to color tokens:
- `above_usual` — green (positive direction)
- `steady` — neutral gray-blue
- `below_usual` — amber (caution, not red — red reserved for safety alerts only)

Score numbers map to ring fill:
- 0–35 → amber band
- 35–65 → neutral band
- 65–100 → green band

Never use red for normal-range states. Red reserved for: data missing, run failed, safety alert (RHR ≥120 sustained, etc.).

## 4.5 Mockups — Home dashboard (4 modes)

Mockups are mobile-first (~360px width). Desktop differences noted at the end.

### Mode A — Morning-fresh

User just woke. Sleep insight ready. Wants: how was last night, am I ready, what now?

```
┌─────────────────────────────┐
│ Mo, 11. Mai · 07:42  MORNING│
├─────────────────────────────┤
│ ↗ ÜBER NORMAL               │
│   Schlafqualität            │
│                  ╭──────╮   │
│   78/100         │  78  │   │
│                  ╰──────╯   │
│ "Gute Nacht, Körper bereit" │
│ Effizienz 94%, RMSSD 67ms   │
│ — beide über Median.        │
├─────────────────────────────┤
│ Heute klein                 │
│ ⚓ RMSSD 67ms (>60d-Median) │
│ • Mittag 5min Spaziergang   │
│   Erhält parasympathisch    │
├─────────────────────────────┤
│ KPIs                        │
│ 🟢 Schlaf 78  🟢 Recovery 72│
│ 🔵 Konsistenz 65            │
├─────────────────────────────┤
│ Drill-down                  │
│ → Schlaf 6h47, alle Stadien │
│ → Recovery HRV-Trend, RHR   │
│ → Aktivität (heute geplant) │
└─────────────────────────────┘
```

### Mode B — Midday

User checks at lunch. Wants: am I on track, anything to act on now?

```
┌─────────────────────────────┐
│ Mo, 11. Mai · 13:15  MIDDAY │
├─────────────────────────────┤
│ Heute bis jetzt             │
│                             │
│ Schritte 4.2k / 7k          │
│ ████████░░░░░░░ 60%         │
│                             │
│ Aktive Min 38 / Ziel 60     │
│ Stress-Mean 28 (norm 22-35) │
├─────────────────────────────┤
│ Mittagspause-Tipp           │
│ ⚓ Sedentary 90min Block    │
│ • 5min raus, frische Luft   │
│   Reset Stress, Augen       │
├─────────────────────────────┤
│ Recovery jetzt              │
│ HRV 67ms (latest)           │
│ RHR-Drift +3 (gut erholt)   │
├─────────────────────────────┤
│ Drill-down                  │
│ → Aktivität heute (4.2k)    │
│ → Recovery State            │
└─────────────────────────────┘
```

### Mode C — Post-workout

Workout just ended (within 90min). Wants: how was that, recovery cost, when next?

```
┌─────────────────────────────┐
│ Mo, 11. Mai · 14:35         │
│ POST-WORKOUT • neu ●        │
├─────────────────────────────┤
│ Lauf 14:00 — 32 min         │
│ 5.2 km · HR avg 152 · max 178│
│ ⚓ Aerobic Effect 2.8       │
│ 🔁 Recovery Time 14h        │
├─────────────────────────────┤
│ ╭──────╮                    │
│ │  72  │ Training-Quality   │
│ ╰──────╯ über Normal        │
│                             │
│ Volume-Load heute 65        │
│ Recovery-Demand 58 (mittel) │
├─────────────────────────────┤
│ Heute klein                 │
│ ⚓ Recovery-Demand 58       │
│ • Trinken 500ml, Snack      │
│   Stützt Adaptation         │
├─────────────────────────────┤
│ Nächstes Training           │
│ Mi, ab 06:00 (Recovery 14h) │
├─────────────────────────────┤
│ Drill-down                  │
│ → Aktivität, Workouts heute │
│ → Recovery, HR-Verlauf      │
└─────────────────────────────┘
```

### Mode D — Evening

End of day. Wants: how was today overall, tomorrow plan, anything urgent?

```
┌─────────────────────────────┐
│ Mo, 11. Mai · 21:08 EVENING │
├─────────────────────────────┤
│ ↘ UNTER NORMAL              │
│   Tag-Score                 │
│                  ╭──────╮   │
│   44/100         │  44  │   │
│                  ╰──────╯   │
│ "Erholung bricht bei        │
│  extremer Last ein"         │
│ Load 203 → Recovery 38      │
│ trotz Schlaf 78.            │
├─────────────────────────────┤
│ Cross-Domain Insight        │
│ Trainings-Load 203 (z=7.3)  │
│ → RMSSD 50ms (Sleep)        │
│ → Recovery 38 (z=-2.7)      │
│ Klassisches Übertrainings-  │
│ Muster heute.               │
├─────────────────────────────┤
│ Heute Abend                 │
│ ⚓ RMSSD 50ms, Load 203     │
│ • Kein Training mehr        │
│   Schont Nervensystem       │
├─────────────────────────────┤
│ Konflikt erkannt 🔁         │
│ Sleep "früh schlafen"       │
│ vs Activity "Dehnen"        │
│ → Sleep gewinnt             │
├─────────────────────────────┤
│ Domain-Übersicht            │
│ 🟢 Schlaf 85    →           │
│ 🟠 Recovery 38  →           │
│ 🟢 Aktivität 95 →           │
└─────────────────────────────┘
```

### Desktop differences (≥1024px)

```
┌──────────────────────┬──────────────────────────┐
│ HERO (left half)     │ Cross-domain insight bnr │
│  ring 180px          │ (full width row 2)       │
│  + headline          ├──────────────────────────┤
│  + summary_long      │ KPI grid (3 columns)     │
│                      │                          │
├──────────────────────┴──────────────────────────┤
│ Heute klein  | Domain pointer cards | Konflikt  │
│ (3 columns, equal width)                        │
├─────────────────────────────────────────────────┤
│ Drill-down rail (3 cards horizontal)            │
└─────────────────────────────────────────────────┘
```

- 2–3 column grid replaces stacked single column
- Per-domain cards expand inline (drawer) rather than navigate
- Cross-domain insight rendered as full-width banner under hero
- Trend sparkline (7-day mini) appears next to each KPI
- Summary uses summary_long, no line-clamp

## 4.6 Mockup — Day detail page

URL: `/day/[date]`. Static, full-day deep view (not mode-driven). Shows everything.

```
┌─────────────────────────────────────┐
│ ← 9. Mai 2026, Sa →                 │
│ Tag-Score 44 • UNTER NORMAL         │
├─────────────────────────────────────┤
│ Headline: "Erholung bricht bei      │
│ extremer Last ein"                  │
│ Summary_long: 200 chars context.    │
│ Confidence ▮▮▮▯▯ mittel             │
├─────────────────────────────────────┤
│ KEY INSIGHT                         │
│ Load 203 (Activity) → RMSSD 50ms    │
│ (Sleep) → Recovery 38. Übertraining-│
│ Muster.                             │
├─────────────────────────────────────┤
│ TOP ACTION HEUTE                    │
│ ⚓ RMSSD 50ms, Load 203 (recovery)  │
│ • Kein Training heute Abend.        │
│   Schont Nervensystem               │
├─────────────────────────────────────┤
│ KONFLIKTE                           │
│ Sleep "früh schlafen" vs            │
│ Activity "Dehnen" → Sleep gewinnt   │
│ Grund: Recovery 38 kritisch.        │
├─────────────────────────────────────┤
│ ─── SCHLAF ────────── 85 ↗ →        │
│ Effizienz 97% · TST 7h02            │
│ ┌─────────────────────────────┐     │
│ │ Hypnogram (24:00 → 08:30)   │     │
│ │ [stages bands rendering]    │     │
│ └─────────────────────────────┘     │
│ HR während Schlaf 52-72bpm          │
│ ┌─────────────────────────────┐     │
│ │ HR sparkline 5min buckets    │     │
│ └─────────────────────────────┘     │
│ → Schlaf-Detail öffnen              │
├─────────────────────────────────────┤
│ ─── RECOVERY ───────── 38 ↘ →       │
│ RMSSD 50ms (z=-2.7) · RHR-Drift —   │
│ Stress-Min 0 (heute)                │
│ ┌─────────────────────────────┐     │
│ │ HRV-Series 40 Punkte heute  │     │
│ └─────────────────────────────┘     │
│ → Recovery-Detail öffnen            │
├─────────────────────────────────────┤
│ ─── AKTIVITÄT ──────── 95 ↗ →       │
│ 3 Workouts · 26.019 Schritte ·      │
│ Load 203 (z=7.3)                    │
│ ┌─────────────────────────────┐     │
│ │ Workouts-Liste               │     │
│ │ • Lauf 09:23 — 159min        │     │
│ │ • Lauf 12:12 — 96min         │     │
│ │ • Lauf 13:49 — 42min         │     │
│ └─────────────────────────────┘     │
│ Hourly Steps Bars                   │
│ HR-Zonen Z1 489m / Z2 147m          │
│ → Aktivität-Detail öffnen           │
├─────────────────────────────────────┤
│ AKTIONS-STAPEL                      │
│ Heute (3): Sleep / Recovery / Act   │
│ Langfristig (2): this_week pattern  │
└─────────────────────────────────────┘
```

Desktop: 3-column grid for domain sections, hero/insight banner full-width above.

Navigation: prev/next day buttons in header. Back to home in cmd-K + nav.

## 4.7 Mockups — Drill-down pages

### Sleep page (`/sleep/[date]`)

```
┌─────────────────────────────────────┐
│ ← 9. Mai 2026 — Schlaf              │
├─────────────────────────────────────┤
│ Schlafqualität              ╭────╮  │
│ über Normal                 │ 85 │  │
│ Effizienz 97%, Latenz 7min  ╰────╯  │
│ TST 7h02 (-44min vs Median)         │
├─────────────────────────────────────┤
│ analysis_today                      │
│ "Stabile Struktur (Deep 100m, REM   │
│ 90m). Latenz 7min sehr kurz. Niedr- │
│ ige Wachzeit (11min)."              │
├─────────────────────────────────────┤
│ analysis_context                    │
│ "TST -9.4% vs Median (z=-0.7).      │
│ RMSSD 50ms (z=-2.7) deutlich unter  │
│ Baseline 70ms. Mittelpunkt 02:53    │
│ vs gestern 03:11."                  │
├─────────────────────────────────────┤
│ HYPNOGRAM (00:17 → 08:30)           │
│ ┌────────────────────────────────┐  │
│ │ light  ▓▓░  ░░░░░░░░░░░░░░░    │  │
│ │ rem        ░░░          ░░░     │  │
│ │ deep   ▓▓        ▓▓             │  │
│ │ awake                ▓          │  │
│ └────────────────────────────────┘  │
├─────────────────────────────────────┤
│ HR während Schlaf (5min Buckets)    │
│ ┌────────────────────────────────┐  │
│ │ Range 50-72 bpm, mean 58       │  │
│ │ [sparkline]                    │  │
│ └────────────────────────────────┘  │
├─────────────────────────────────────┤
│ SpO₂ während Schlaf                 │
│ ┌────────────────────────────────┐  │
│ │ Min 96%, Mean 98%              │  │
│ └────────────────────────────────┘  │
├─────────────────────────────────────┤
│ KPIs (mit reasoning expandable)     │
│ → Schlafqualität 85 above          │
│ → Recovery_readiness 35 below       │
│ → Schlaf-Konsistenz 40 below        │
│ → autonomic_balance 38 below        │
├─────────────────────────────────────┤
│ Suggestions                         │
│ [today: 0-3 cards]                  │
│ [long_term: 0-3 cards]              │
├─────────────────────────────────────┤
│ Trend (letzte 14 Tage)              │
│ ┌────────────────────────────────┐  │
│ │ Schlafqualität-Linie + bands   │  │
│ │ Heute markiert ●                │  │
│ └────────────────────────────────┘  │
├─────────────────────────────────────┤
│ Cross-Links                         │
│ → Recovery beeinflusst Schlaf       │
│ → Aktivität → Recovery →  Schlaf    │
└─────────────────────────────────────┘
```

### Recovery page (`/recovery/[date]`)

Similar shape. Hero: recovery_score + autonomic_balance + stress_load. Charts: HRV series 24h, RHR-drift trend, stress timeline. Trend: 14d HRV with baseline band. Cross-link: "vorgestern 75ms → gestern 68ms → heute 50ms".

### Activity page (`/activity/[date]`)

Hero: training_quality + volume_load + recovery_demand. Sections:
- Workouts-Liste (full BASE_ACTIVITY_SUMMARY rows + summary_data fields)
- Hourly steps bar chart
- HR-Zones donut (Z1-Z5 minutes)
- Sedentary blocks timeline
- 7d cumulative load + baseline
- Cross-link: "Recovery state today" + "Sleep last night"

## 4.8 Component inventory + map

Audit of `components/` tree, classified for v3 work.

### Legend

- **REUSE** — works as-is for v3, no changes needed
- **MODIFY** — small adapter or prop shape change
- **REPLACE** — meaningful rewrite (concept survives, code mostly changes)
- **NEW** — build from scratch
- **DROP** — v2-specific, no v3 home

### UI primitives (`components/ui/`)

| Component | Status | Notes |
|---|---|---|
| `card.tsx` | REUSE | Base card primitive |
| `confidence-bar.tsx` | REUSE | Thin bar visual, fits v3 confidence display |
| `eyebrow.tsx` | REUSE | Small label above headlines |
| `glyph.tsx` | REUSE | Icon wrapper |
| `in-progress-badge.tsx` | MODIFY | Becomes "neu" badge for freshly-arrived data; supports WS-driven state |
| `num.tsx` | REUSE | Number formatter |
| `pill.tsx` | REUSE | Tag/chip primitive |
| `pulse-dot.tsx` | REUSE | Live-data indicator |
| `score-ring.tsx` | MODIFY | Bands aligned to new color tokens (above/steady/below); deterministic day_score input |
| `section.tsx` | REUSE | Section wrapper |
| `skeleton.tsx` | REUSE | Loading skeleton primitive |
| `stat.tsx` | MODIFY | Add inline baseline range + delta + drill-affordance per density principles |

### Domain components (`components/domain/`)

| Component | Status | Notes |
|---|---|---|
| `hero-verdict.tsx` | REPLACE | New `hero-v3.tsx`. Reads daily_v3.json (verdict_band + day_score + headline + summary_short/long). Drop confidence-as-headline confusion. Mode-aware. |
| `metric-tile.tsx` | MODIFY | Inline baseline (median ± MAD), delta, sparkline, workout-context label for HR; tap = drill-down |
| `comparison-card.tsx` | MODIFY | Refit to consume v3 deltas + multi-day diffs (last 2 + 30d) |
| `recovery-card.tsx` | REPLACE | Becomes generic `domain-pointer-card.tsx` driven by daily_v3.domain_pointers entry |
| `domain-chrome.tsx` | REUSE | Section frame for drill-down pages |
| `anomaly-inbox.tsx` | DROP | v2 surprise_insights system, replaced by synthesis contradictions + key_insight |
| `explain-spike-button.tsx` | DROP | v2 anomaly explainer; v3 packages already attach context |

### Charts (`components/charts/`)

| Component | Status | Notes |
|---|---|---|
| `hypnogram.tsx` | REUSE | Sleep stages timeline; consumes sleep_package.today.stages_timeline |
| `stage-donut.tsx` | REUSE | Stage distribution donut |
| `sparkline.tsx` | REUSE | Inline mini-trends |
| `timeline.tsx` | REUSE | Generic timeline base |
| `bar-day.tsx` | REUSE | Hourly bars (steps, stress) |
| `band-strip.tsx` | REUSE | 14-day strip with band fill |
| `gps-map*.tsx` | REUSE | Workout GPS rendering |
| `activity-charts.tsx` | MODIFY | Adapt to activity_package shape |
| `dynamic/calendar.tsx` | REUSE | Pattern calendar |
| `dynamic/comparison.tsx` | REUSE | Comparison chart factory |
| `dynamic/distribution.tsx` | REUSE | Distribution chart |
| `dynamic/factory.tsx` | REUSE | Dynamic chart dispatcher |
| `dynamic/meta.ts` | REUSE | Chart metadata |
| `dynamic/panel.tsx` | REUSE | Panel wrapper |
| `dynamic/scatter.tsx` | REUSE | Scatter chart |
| `dynamic/stacked.tsx` | REUSE | Stacked area |
| `dynamic/trend.tsx` | REUSE | Trend chart |

### Coach + log (`components/coach/`, `components/log/`)

| Component | Status | Notes |
|---|---|---|
| `coach/coach-takeaway.tsx` | REPLACE | New `top-action-card.tsx` for daily_v3.top_action_today; per-domain `suggestions-stack.tsx` for use-case suggestions |
| `log/feel-form.tsx` | REUSE | Manual feel logging |
| `log/journal-form.tsx` | REUSE | Journal entry |
| `log/weight-form.tsx` | REUSE | Weight logging |
| `log/form-feedback.tsx` | REUSE | Form feedback |
| `log/action-state.ts` | REUSE | Server actions |

### Motion (`components/motion/`)

| Component | Status | Notes |
|---|---|---|
| `fade-rise.tsx` | REUSE | Fade+rise animation |
| `number-ticker.tsx` | REUSE | Animated number transition |
| `page-transition.tsx` | REUSE | Page transition wrapper |
| `stagger.tsx` | REUSE | Stagger children animations |

### Nav (`components/nav/`)

| Component | Status | Notes |
|---|---|---|
| `bottom-nav.tsx` | MODIFY | Add Recovery + Activity tabs |
| `topbar.tsx` | MODIFY | Same |
| `sidebar.tsx` | MODIFY | Same |
| `cmd-k.tsx` | MODIFY | Add v3 page targets (recovery, activity, drill-downs) |
| `day-navigator.tsx` | REUSE | Prev/next day chrome |
| `score-calendar.tsx` | MODIFY | Reads daily_v3.day_score for cells |
| `arrow-nav-list.tsx` | REUSE | Arrow nav list |

### Skeletons (`components/skeletons/`)

| Component | Status | Notes |
|---|---|---|
| `landing-skeleton.tsx` | MODIFY | New mode-aware skeleton |
| `day-skeleton.tsx` | REUSE | Day page skeleton |
| `domain-detail-skeleton.tsx` | REUSE | Drill-down skeleton |
| `coach-skeleton.tsx` | REUSE | Coach card skeleton |
| `explore-skeleton.tsx` | REUSE | Explore page skeleton |

### Explore + theme

| Component | Status | Notes |
|---|---|---|
| `explore/metric-detail-panels.tsx` | REUSE | Historical exploration |
| `theme-provider.tsx` | REUSE | Theme context |

### NEW components to build

| Component | Path | Purpose |
|---|---|---|
| `domain/hero-v3.tsx` | replaces hero-verdict | Mode-aware hero, verdict + day_score + summary |
| `domain/post-workout-card.tsx` | new | Post-workout fresh-arrival card |
| `domain/key-insight-banner.tsx` | new | Cross-domain insight from daily_v3.key_insight |
| `domain/contradiction-card.tsx` | new | Renders daily_v3.contradictions[i] |
| `domain/domain-pointer-card.tsx` | new | Drill-down launchpad card per domain pointer |
| `domain/top-action-card.tsx` | new | Single top action across domains |
| `domain/suggestions-stack.tsx` | new | Per-domain suggestions today + long_term |
| `dashboard/mode-banner.tsx` | new | Top-of-page mode tag (MORNING / POST-WORKOUT / etc) |
| `dashboard/run-progress.tsx` | new | WS-driven live run progress |
| `dashboard/freshness-pulse.tsx` | new | Pulse animation wrapper for freshly-arrived data |
| `pwa/install-prompt.tsx` | new | PWA install hint |
| `pwa/push-subscribe.tsx` | new | Web push opt-in flow |
| `lib/dashboard/mode.ts` | new (lib) | Pure mode-engine function |
| `lib/realtime/ws-client.ts` | new (lib) | Browser WS client + reconnect |
| `lib/types/v3.ts` | new (lib) | TS types from v3 schemas |

### NEW server-side modules

| Module | Path | Purpose |
|---|---|---|
| `app/api/run/[date]/route.ts` | new | Trigger v3 run |
| `app/api/run/[date]/status/route.ts` | new | Run status fallback |
| `app/api/insights/[date]/[domain]/route.ts` | new | Insight readers (sleep/recovery/activity/synthesis) |
| `app/api/push/subscribe/route.ts` | new | Push subscription register |
| `app/api/push/unsubscribe/route.ts` | new | Push unsubscribe |
| `app/api/push/test/route.ts` | new | Send test push |
| `app/sw.ts` (or public/sw.js) | new | Service worker for push + offline |
| `runner/src/scheduler/cron.ts` | new | Cron trigger registration (or via system cron) |
| `runner/src/scheduler/db-poller.ts` | new | Db poller for post-workout + morning wake |
| `runner/src/scheduler/push-dispatcher.ts` | new | Web push send + subscription store |
| `runner/src/realtime/ws-broker.ts` | new | WS broker emitting run events |

## 4.10 Push setup

Web Push uses VAPID. Keys are generated once and reused across the dashboard
server (subscription register / dispatcher) and the runner-side push dispatcher.

**Generation (one-time):**

```bash
npx web-push generate-vapid-keys --json
```

**Where keys live:**

- Local source of truth: `runner/.vapid-keys.json` (gitignored). Holds
  `publicKey`, `privateKey`, and the `subject` (mailto). Never commit.
- Runtime: read from `process.env` on the Pi via the helper at
  `lib/push/vapid.ts` (`getVapidConfig()`), which validates and caches them.

**Required env vars (Pi `.env.local` — see `.env.example` at repo root):**

| Var | Example | Notes |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `BHtG…` | Public key, base64url. Also handed to the browser by the subscribe API. |
| `VAPID_PRIVATE_KEY` | `VMCg…` | Private key, base64url. Server-only — never expose. |
| `VAPID_SUBJECT` | `mailto:you@example.com` | Must start with `mailto:` or `https://`. |

**Files using these:**

- `lib/push/vapid.ts` — env loader + validator (`getVapidConfig`).
- `app/api/push/subscribe/route.ts` *(future)* — registers a `PushSubscription`.
- `app/api/push/unsubscribe/route.ts` *(future)* — removes it.
- `app/api/push/test/route.ts` *(future)* — smoke-test endpoint.
- `runner/src/scheduler/push-dispatcher.ts` *(future)* — sends push payloads
  on synthesis / morning / post-workout / evening triggers.

When deploying to the Pi, copy the values from `runner/.vapid-keys.json` into
the Next.js `.env.local`. Re-running `web-push generate-vapid-keys` invalidates
all existing browser subscriptions, so do it sparingly.

## Phase 5 implementation order

Recommended build sequence (Phase 5 tasks):

1. **5.1 Type generation** — JSON Schema → TS types for all v3 outputs (sleep_insight, recovery_insight, activity_insight, synthesis (daily_v3), packages). Lib path `lib/types/v3.ts`. Single import surface for the rest of the build.

2. **5.2 Data loaders** — `lib/data/v3-loaders.ts` with `loadSleepInsight(date)`, `loadRecoveryInsight(date)`, `loadActivityInsight(date)`, `loadDailyV3(date)`, `loadDayScore(date)`, `loadPackage(date, domain)`. Server-only readers using existing insightsRoot path.

3. **5.4 Mode engine** — `lib/dashboard/mode.ts` pure function. Build with fixture inputs first, no UI yet. Snapshot test each mode case.

4. **5.3 Hero v3** — `components/domain/hero-v3.tsx`. New ring + verdict + summary. Uses `daily_v3.json` + `day_score.json`. Mode-aware accent. Replaces hero-verdict.

5. **5.6 Annotated metric tiles** — modify `metric-tile.tsx` per density principles. Inline baseline/delta/sparkline/drill-target.

6. **NEW: api/insights endpoints + api/run + WS broker** — server-side plumbing before drill-downs. Stock-dashboard polling pattern adapted to WS.

7. **5.7 Drill-down pages** — sleep already exists, modify to consume v3. Recovery + Activity new. Each follows the mockup in 4.7. Reuse charts directly.

8. **5.5 Post-workout card** — fresh-arrival surfacing. Tied to mode engine + WS event.

9. **5.8 Mobile fixes** — drop line-clamp, swap to summary_short/long by viewport, expandable for long sections.

10. **NEW: PWA + push** — manifest, service worker, subscribe flow, dispatcher in runner. Last because requires VAPID setup + cron.

11. **5.10 Navigation + IA** — bottom-nav + cmd-k + cross-links. Polish pass.

12. **5.9 Charts adapt** — most charts reuse as-is; a few need shape adapters.

Dependencies wired in tasks. Suggest running 1-3 in sequence (foundations), then 4-7 in parallel where possible.


