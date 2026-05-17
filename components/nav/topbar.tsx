"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Glyph } from "@/components/ui/glyph";
import { CommandKTrigger } from "./cmd-k";
import { cn } from "@/lib/cn";

export function Topbar({ alarmCount = 0 }: { alarmCount?: number }) {
  const pathname = usePathname();
  const crumb = pathToCrumb(pathname);

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 h-14 px-4 lg:px-6 border-b border-[var(--color-border)]/60 bg-[var(--color-bg)]/85 backdrop-blur-md">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Link href="/" className="lg:hidden flex items-center gap-2 font-semibold tracking-tight">
          <span className="size-6 rounded-md bg-gradient-to-br from-[var(--color-sleep)] to-[var(--color-sleep-2)] grid place-items-center">
            <Glyph name="Sparkles" size={12} strokeWidth={2.25} className="text-white" />
          </span>
          Pulse
        </Link>
        <div className="hidden lg:flex items-center gap-2 text-[0.875rem]">
          <span className="text-subtle">{crumb.section}</span>
          {crumb.detail && (
            <>
              <Glyph name="ChevronRight" size={14} className="text-faint" />
              <span className="num-mono text-muted">{crumb.detail}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <CommandKTrigger />
        <Link
          href="/alarms"
          className={cn(
            "relative grid place-items-center size-9 rounded-[var(--radius-chip)] hover:bg-[var(--color-surface)]/80 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors",
          )}
          aria-label="Alarme"
        >
          <Glyph name="Bell" size={16} />
          {alarmCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--color-tier-s2)] ring-2 ring-[var(--color-bg)]" />
          )}
        </Link>
      </div>
    </div>
  );
}

function pathToCrumb(pathname: string): { section: string; detail?: string } {
  if (pathname === "/") return { section: "Home" };
  const seg = pathname.split("/").filter(Boolean);
  const map: Record<string, string> = {
    day: "Tag",
    sleep: "Schlaf",
    heart: "Herz",
    body: "Körper",
    activity: "Bewegung",
    activities: "Aktivitäten",
    workouts: "Aktivitäten",
    stress: "Stress",
    coach: "Coach",
    explore: "Explore",
    alarms: "Alarme",
    log: "Log",
    profile: "Profil",
    labs: "Labs",
    week: "Woche",
  };
  return { section: map[seg[0]] ?? seg[0], detail: seg[1] };
}
