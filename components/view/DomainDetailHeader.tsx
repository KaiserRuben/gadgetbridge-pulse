"use client";

import Link from "next/link";

import { FadeRise } from "@/components/motion/fade-rise";
import { NumberTicker } from "@/components/motion/number-ticker";
import { Sparkline } from "@/components/charts/sparkline";
import { DateSwipe } from "@/components/nav/date-swipe";
import { Glyph } from "@/components/ui/glyph";
import { addDays } from "@/lib/time";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body" | "hrv";

export interface DetailHero {
  value: number | null;
  /** Eyebrow above the number, e.g. "Gesamtschlaf". */
  label: string;
  unit?: string;
  /** int → de-DE thousands · hm → h:mm from minutes · dec1 → one decimal. */
  fmt?: "int" | "hm" | "dec1";
}

/**
 * The drill-down twin of {@link HeroHeader}: a domain detail page opens with
 * the same hero rhythm as the v4 home — a back link to the day, a colour-dotted
 * domain eyebrow over the date, one signature number, and the 14-day trend on
 * the right. Keeps the day-to-day nav (chevrons + mobile swipe) the per-domain
 * pages had before. Server pages compute the values; this only presents them.
 */
export function DomainDetailHeader({
  domainLabel,
  date,
  hrefBase,
  tone,
  hero,
  support,
  trend,
}: {
  domainLabel: string;
  date: string;
  hrefBase: string;
  tone: Tone;
  hero: DetailHero;
  support?: string | null;
  trend?: { series: Array<number | null>; label: string };
}) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <FadeRise>
      <header className="flex flex-col gap-5">
        {/* mobile swipe nav — no DOM output */}
        <DateSwipe prevHref={`${hrefBase}/${prev}`} nextHref={`${hrefBase}/${next}`} />

        <div className="flex flex-col gap-1.5">
          <Link
            href={`/v4?d=${date}`}
            className="w-fit text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)]"
          >
            ← Übersicht
          </Link>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <span className="eyebrow flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: toneVar(tone) }}
                />
                {domainLabel}
              </span>
              <h1 className="text-hero text-[var(--color-text-strong)]">{fmtDate(date)}</h1>
            </div>
            <nav className="flex shrink-0 items-center gap-1">
              <NavChevron href={`${hrefBase}/${prev}`} dir="prev" />
              <NavChevron href={`${hrefBase}/${next}`} dir="next" />
            </nav>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,auto)_1fr] md:items-end">
          <div className="flex flex-col gap-1">
            <span className="eyebrow">{hero.label}</span>
            <div className="flex items-baseline gap-2">
              <HeroValue hero={hero} />
              {hero.unit && hero.value != null ? (
                <span className="num-mono text-[0.875rem] text-[var(--color-text-subtle)]">
                  {hero.unit}
                </span>
              ) : null}
            </div>
            {support ? (
              <p className="num text-[0.8125rem] text-[var(--color-text-subtle)]">{support}</p>
            ) : null}
          </div>

          {trend ? (
            <div className="flex md:justify-end">
              <TrendCell tone={tone} series={trend.series} label={trend.label} />
            </div>
          ) : null}
        </div>
      </header>
    </FadeRise>
  );
}

function HeroValue({ hero }: { hero: DetailHero }) {
  const cls = "text-display text-[var(--color-text-strong)]";
  if (hero.value == null || !Number.isFinite(hero.value)) {
    return (
      <span className="text-[1.75rem] text-[var(--color-text-muted)]">noch keine</span>
    );
  }
  if (hero.fmt === "hm") {
    const h = Math.floor(hero.value / 60);
    const m = Math.round(hero.value % 60);
    return (
      <span className={cls}>
        {h}
        <span className="text-[0.5em] text-[var(--color-text-subtle)]">h </span>
        {m.toString().padStart(2, "0")}
      </span>
    );
  }
  return (
    <NumberTicker
      value={hero.value}
      decimals={hero.fmt === "dec1" ? 1 : 0}
      className={cls}
    />
  );
}

function TrendCell({
  tone,
  series,
  label,
}: {
  tone: Tone;
  series: Array<number | null>;
  label: string;
}) {
  const present = series.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const last = present[present.length - 1];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow">{label}</span>
        <span className="num text-[0.8125rem] font-semibold text-[var(--color-text)]">
          {Math.round(last).toLocaleString("de-DE")}
        </span>
      </div>
      <Sparkline values={series} tone={tone} width={148} height={34} markers fill />
      <span className="text-[0.625rem] text-[var(--color-text-faint)]">14 Tage</span>
    </div>
  );
}

function NavChevron({ href, dir }: { href: string; dir: "prev" | "next" }) {
  return (
    <Link
      href={href}
      aria-label={dir === "prev" ? "Vorheriger Tag" : "Nächster Tag"}
      className="grid size-9 place-items-center rounded-[var(--radius-chip)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
    >
      <Glyph name="ChevronRight" size={16} className={dir === "prev" ? "rotate-180" : ""} />
    </Link>
  );
}

function toneVar(tone: Tone): string {
  switch (tone) {
    case "sleep":
      return "var(--color-sleep)";
    case "heart":
      return "var(--color-heart)";
    case "activity":
      return "var(--color-activity)";
    case "stress":
      return "var(--color-stress)";
    case "body":
      return "var(--color-temp)";
    case "hrv":
      return "var(--color-hrv)";
  }
}

function fmtDate(periodKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d
    .toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
    .replace(", ", " · ");
}
