import Link from "next/link";
import type { ReactNode } from "react";

import { Eyebrow } from "./eyebrow";
import { cn } from "@/lib/cn";

/**
 * Standard page header in the /v4 design language: optional back link, an
 * eyebrow + hero-scale title, an optional trailing action, and a sub line.
 * Server-safe (no hooks) so it drops into any page. Use this instead of
 * hand-rolled `<h1 className="text-2xl ...">` blocks for consistency.
 */
export function PageHeader({
  eyebrow,
  title,
  sub,
  back,
  trailing,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  back?: { href: string; label?: string };
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-1.5", className)}>
      {back ? (
        <Link
          href={back.href}
          className="w-fit text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)]"
        >
          ← {back.label ?? "Zurück"}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="text-hero text-[var(--color-text-strong)]">{title}</h1>
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {sub ? (
        <p className="text-[0.875rem] text-[var(--color-text-muted)]">{sub}</p>
      ) : null}
    </header>
  );
}
