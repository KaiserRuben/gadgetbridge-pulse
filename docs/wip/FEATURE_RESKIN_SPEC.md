# Feature-page reskin spec (Wave 4)

Target: bring the feature pages to the **`/v4` design language** that the home,
day, week, coach, and the 6 domain drill pages now use. This is a **full reskin**
(layout/IA + tokens + motion), **not** a data migration — keep every page's data
source and behavior identical. Touch only presentation.

## Hard rules

1. **No data/behavior changes.** Don't change loaders, queries, mutations, route
   params, form submit logic, or API calls. Only JSX/markup/className/motion.
2. **Typecheck must pass.** Run `npm run typecheck` (root) after your edits; fix
   anything you broke. Don't leave unused imports.
3. **Server vs client.** Keep `"use client"` exactly where it already is. Motion
   primitives + IconBadge are fine in either (IconBadge/PageHeader are
   server-safe; FadeRise/Stagger are client — only add them inside client
   components or wrap server children passed as `children`).
4. **Dock padding is centralized** in `app/(app)/layout.tsx` (`.pb-dock`). Do NOT
   add `pb-28`/`pb-dock`/bottom padding to a page's `<main>` — remove any you find.
5. **Don't invent new colors/sizes.** Use the tokens below. No new `hsl(...)`.

## Use these primitives (don't hand-roll)

- `PageHeader` (`@/components/ui/page-header`) — eyebrow + hero-scale title +
  optional `back={{href,label}}` + `trailing` + `sub`. Replace every page's
  hand-rolled `<h1 className="text-2xl…">` / ad-hoc header block with this.
- `IconBadge` (`@/components/ui/icon-badge`) — `icon` (GlyphName), `tone`
  (neutral|sleep|heart|activity|stress|nutrition|body), `size` (sm|md|lg),
  `variant` (soft|solid). Replace every hand-rolled
  `grid place-items-center size-N rounded-… bg-…` icon chip with this.
- `Card` / `CardBody` / `CardHeader` / `CardFooter` (`@/components/ui/card`) —
  `variant` surface|soft|flat, `glow` (domain), `hoverable`.
- `Section` (`@/components/ui/section`) — eyebrow + title + `trailing` wrapper
  for a titled block.
- `Stat` (`@/components/ui/stat`), `Eyebrow`, `Pill`.
- `Sparkline` (`@/components/charts/sparkline`) — gap-aware, accepts
  `(number|null)[]`, `tone`.
- Motion: `FadeRise` (`@/components/motion/fade-rise`) on async/section reveals;
  `Stagger`/`StaggerItem` (`@/components/motion/stagger`) on lists/card grids;
  `NumberTicker` (`@/components/motion/number-ticker`) on prominent KPI numbers.
  All are reduced-motion aware via `useMotionPrefs` — don't gate yourself.

## Token vocabulary (kill the ad-hoc values)

- **Type:** use the `.text-*` utility classes, not raw `text-[Npx]`:
  `.text-hero` (page title), `.text-h2`, `.text-title` (card title),
  `.text-body` / `.text-body-sm`, `.text-caption`, `.eyebrow` (uppercase mono
  label), `.num` / `.num-mono` (tabular numbers). `.text-display` for a single
  hero number.
- **Color:** `var(--color-text | -strong | -muted | -subtle | -faint)`,
  `var(--color-surface | -2 | -3 | -soft)`, `var(--color-border | -strong)`,
  domain accents `var(--color-sleep|heart|activity|stress|nutrition|temp|hrv)`,
  bands `var(--color-band-up|down|steady)`. **Never inline `hsl(...)`** in a
  className — replace with the matching token.
- **Radius:** `rounded-[var(--radius-card)]` (cards), `-pill`, `-chip`, `-sm`,
  `-xs`. Replace bare `rounded-xl`/`rounded-2xl`/`rounded-3xl`.
- **Shadow:** `var(--shadow-card)` / `var(--shadow-pop)`. Replace ad-hoc
  `shadow-[...]`. (Note: `.surface` already sets a box-shadow — to override on a
  card, set `style={{ boxShadow: "var(--shadow-pop)" }}` since utilities lose to
  it.)
- **Motion timing:** `--dur-instant|fast|base|slow`, `--ease-out|in-out`.

## Reskin recipe (per page)

1. Replace the header with `<PageHeader …/>` (eyebrow + hero title; `back` link
   for detail pages like `/x/[id]`).
2. Set the page root to a consistent rhythm: `flex flex-col gap-6` (or
   `space-y-6`). No bottom padding (layout owns it).
3. Group content into `Section`s / `Card`s. Card padding `p-4`–`p-5`. Use
   `Card variant="soft"` for secondary panels.
4. Replace hand-rolled icon chips with `IconBadge`.
5. Sweep tokens: raw `text-[Npx]`→`.text-*`; inline `hsl()`→`--color-*`;
   `rounded-xl/2xl`→`--radius-*`; ad-hoc shadows→`--shadow-*`.
6. Add tasteful motion: wrap the primary content/sections in `FadeRise`; turn
   card grids / lists into `Stagger`+`StaggerItem`; `NumberTicker` on the page's
   headline number(s). Keep it subtle — match the drill/home pages.
7. Hover affordance on interactive cards: `hoverable` on `Card`, or
   `transition-colors hover:bg-[var(--color-surface-2)]` on rows.
8. Form controls (weight/feel/journal/settings/notifications): align inputs,
   labels, toggles to tokens; keep submit logic untouched.

## Reference implementations (read these for the house style)

- `app/(app)/v4/page.tsx`, `components/view/HeroHeader.tsx`,
  `components/view/Tier1Tile.tsx` — hero + grouped strip + motion.
- `app/(app)/sleep/[date]/page.tsx` — Section/Card/Stat/Sparkline rhythm.
- `app/(app)/coach/page.tsx` — PageHeader + Stagger list.

## Page groups (one worker each, sequential)

1. **nutrition** — `nutrition/{page,[date],log,meal/[id],targets,trends}` (+
   `components/nutrition/*` it renders). Worst offender: 16 inline `hsl()`.
2. **training** — `training/{page,session/[id],proposals,proposals/[id],chat}`.
3. **log** — `log/{page,weight,feel,journal}` (form-heavy).
4. **settings** — `settings/{page,notifications,clusters}` (toggles/forms).
5. **explore** — `explore/{page,[metric]}`.
6. **labs** — `labs/page`.
7. **activities** — `activities/{page,[id]}`.
8. **workouts** — `workouts/{page,[id]}` (5 inline `hsl()`).
9. **profile** — `profile/page`.
