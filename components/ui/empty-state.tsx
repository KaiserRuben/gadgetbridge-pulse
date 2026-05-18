"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { InProgressBadge } from "@/components/ui/in-progress-badge";
import { cn } from "@/lib/cn";
import { getClusterCopy } from "@/lib/derived/cluster-copy";

import { useMotionPrefs } from "@/components/motion/_lib";

/**
 * EmptyStateCard — the single empty-state primitive for the dashboard.
 *
 * Covers the seven `cause` cases the redesign codifies. Each cause owns a
 * default headline + icon + CTA shape; per-call overrides win when needed.
 * When `cluster` is passed and the cause is `preflight` / `abstained`, copy
 * is sourced from `lib/derived/cluster-copy.ts` so /settings/clusters and
 * the in-page CTAs always agree.
 *
 * Visual: `Card variant="soft"` (or red ring for `failed`). Composition is
 * always eyebrow → icon row → headline → optional reason → optional CTA.
 *
 * Motion: honours `useMotionPrefs()` — when `reduce` is true the wrapper
 * renders statically.
 */

export type EmptyCause =
  | "no_data"
  | "computing"
  | "abstained"
  | "failed"
  | "auto_off"
  | "preflight"
  | "windowed_out";

interface EmptyStateCta {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateCardProps {
  cause: EmptyCause;
  /** When present, copy pulled from cluster-copy.ts (preflight/abstained). */
  cluster?: string;
  /** Override default copy. */
  headline?: string;
  /** Free text (abstain_reason etc.). */
  reason?: string;
  cta?: EmptyStateCta;
  className?: string;
  /**
   * Compact single-line variant. Drops the icon block + multi-line layout
   * for one tight row — used on home page banners where the full card
   * crowds the viewport. Keeps eyebrow/headline/CTA contract.
   */
  compact?: boolean;
}

interface CauseTheme {
  eyebrow: string;
  icon: GlyphName;
  iconTone: string;
  defaultHeadline: string;
  defaultCta: EmptyStateCta | null;
  /** Optional override for the surface style. */
  surface?: "soft" | "danger" | "preflight" | "auto_off";
}

const CAUSE_THEME: Record<EmptyCause, CauseTheme> = {
  no_data: {
    eyebrow: "Aktuell",
    icon: "Database",
    iconTone: "var(--color-text-subtle)",
    defaultHeadline: "Noch keine Daten für diesen Zeitraum.",
    defaultCta: null,
    surface: "soft",
  },
  computing: {
    eyebrow: "Heute Nacht",
    icon: "Hourglass",
    iconTone: "var(--color-sleep)",
    defaultHeadline: "Wird heute Nacht berechnet.",
    defaultCta: null,
    surface: "soft",
  },
  abstained: {
    eyebrow: "Auswertung",
    icon: "FlaskConical",
    iconTone: "var(--color-band-down)",
    defaultHeadline: "Datenfenster zu schmal — keine Auswertung.",
    defaultCta: null,
    surface: "soft",
  },
  failed: {
    eyebrow: "Fehler",
    icon: "AlertTriangle",
    iconTone: "var(--color-tier-s1)",
    defaultHeadline: "Aktualisierung fehlgeschlagen.",
    defaultCta: { label: "Erneut versuchen" },
    surface: "danger",
  },
  auto_off: {
    eyebrow: "Auto-Verarbeitung",
    icon: "PowerOff",
    iconTone: "var(--color-text-subtle)",
    defaultHeadline: "Auto-Verarbeitung ist für diesen Cluster aus.",
    defaultCta: { label: "In Einstellungen anpassen", href: "/settings/clusters" },
    surface: "auto_off",
  },
  preflight: {
    eyebrow: "Bereit",
    icon: "Sparkles",
    iconTone: "var(--color-sleep)",
    defaultHeadline: "Tap, um zu berechnen.",
    defaultCta: { label: "Anfordern" },
    surface: "preflight",
  },
  windowed_out: {
    eyebrow: "Zeitfenster",
    icon: "Clock",
    iconTone: "var(--color-text-subtle)",
    defaultHeadline: "Außerhalb des relevanten Zeitfensters.",
    defaultCta: null,
    surface: "soft",
  },
};

function resolveCopy(
  cause: EmptyCause,
  cluster: string | undefined,
  override: string | undefined,
  reason: string | undefined,
): { headline: string; reason?: string } {
  const theme = CAUSE_THEME[cause];
  if (override) return { headline: override, reason };

  if (cluster) {
    const cc = getClusterCopy(cluster);
    if (cc) {
      if (cause === "preflight") {
        return { headline: `${cc.label} berechnen?`, reason };
      }
      if (cause === "abstained") {
        return { headline: reason ?? cc.abstainFallback };
      }
    }
  }

  if (cause === "abstained" && reason) {
    return { headline: reason };
  }
  return { headline: theme.defaultHeadline, reason };
}

function resolveCta(
  cause: EmptyCause,
  cluster: string | undefined,
  override: EmptyStateCta | undefined,
): EmptyStateCta | null {
  if (override) return override;
  const theme = CAUSE_THEME[cause];
  if (cause === "preflight" && cluster) {
    const cc = getClusterCopy(cluster);
    if (cc) return { label: cc.emptyCta };
  }
  return theme.defaultCta;
}

function surfaceClass(surface: CauseTheme["surface"]): string {
  switch (surface) {
    case "danger":
      return "ring-1 ring-[hsl(4_56%_28%)]/60 bg-[hsl(4_60%_10%)]/40";
    case "preflight":
      return "ring-1 ring-[hsl(252_40%_30%)]/60 bg-[hsl(252_40%_14%)]/30";
    case "auto_off":
      return "border-dashed";
    default:
      return "";
  }
}

export function EmptyStateCard({
  cause,
  cluster,
  headline,
  reason,
  cta,
  className,
  compact = false,
}: EmptyStateCardProps): ReactNode {
  const theme = CAUSE_THEME[cause];
  const prefs = useMotionPrefs();
  const copy = resolveCopy(cause, cluster, headline, reason);
  const resolvedCta = resolveCta(cause, cluster, cta);

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 flex-wrap px-3 py-2 rounded-[var(--radius-card)] bg-[var(--color-surface)]/40 border border-[var(--color-border)]/60 text-caption",
          surfaceClass(theme.surface),
          className,
        )}
        data-empty-cause={cause}
        data-empty-compact="true"
      >
        <Glyph name={theme.icon} size={12} style={{ color: theme.iconTone }} />
        <span className="text-subtle">{copy.headline}</span>
        {copy.reason && copy.reason !== copy.headline && (
          <span className="text-faint">· {copy.reason}</span>
        )}
        {cause === "computing" && (
          <InProgressBadge placement="inline" />
        )}
        {resolvedCta && (
          <span className="ml-auto">
            <EmptyStateCtaButton cta={resolvedCta} cause={cause} />
          </span>
        )}
      </div>
    );
  }

  const variant = "soft" as const;

  return (
    <Card
      variant={variant}
      className={cn(surfaceClass(theme.surface), className)}
      data-empty-cause={cause}
      data-motion-reduce={prefs.reduce || undefined}
    >
      <CardBody className="p-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Eyebrow>{theme.eyebrow}</Eyebrow>
          {cause === "computing" && (
            <InProgressBadge placement="inline" />
          )}
        </div>
        <div className="flex items-start gap-3">
          <span
            className="grid place-items-center size-9 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shrink-0"
            style={{ color: theme.iconTone }}
          >
            <Glyph name={theme.icon} size={18} />
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-title">{copy.headline}</span>
            {copy.reason && copy.reason !== copy.headline && (
              <span className="text-caption text-muted">{copy.reason}</span>
            )}
          </div>
        </div>
        {resolvedCta && (
          <div>
            <EmptyStateCtaButton cta={resolvedCta} cause={cause} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EmptyStateCtaButton({
  cta,
  cause,
}: {
  cta: EmptyStateCta;
  cause: EmptyCause;
}) {
  const cls = cn(
    "inline-flex items-center gap-1.5 text-[0.875rem] px-3 py-1.5 rounded-[var(--radius-chip)]",
    cause === "preflight"
      ? "bg-[var(--color-sleep)]/15 text-[var(--color-sleep)] border border-[var(--color-sleep)]/30 hover:bg-[var(--color-sleep)]/25"
      : cause === "failed"
        ? "bg-[hsl(4_60%_18%)] text-[var(--color-tier-s1)] border border-[hsl(4_56%_28%)] hover:bg-[hsl(4_60%_22%)]"
        : "bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]",
  );

  if (cta.href) {
    return (
      <Link href={cta.href} className={cls}>
        {cta.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={cta.onClick} className={cls}>
      {cta.label}
    </button>
  );
}
