"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { NAV_DESKTOP_SECTIONS, type NavItem } from "@/lib/constants";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { cn } from "@/lib/cn";

export function Sidebar({ alarmCount = 0 }: { alarmCount?: number }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col gap-6 sticky top-0 h-dvh w-[228px] shrink-0 px-4 py-6 border-r border-[var(--color-border)] bg-[var(--color-bg)]/60 backdrop-blur-sm">
      <Link href="/v4" className="flex items-center gap-2 px-2 group">
        <div className="relative size-7 grid place-items-center rounded-md bg-gradient-to-br from-[var(--color-sleep)] to-[var(--color-sleep-2)]">
          <Glyph name="Sparkles" size={14} strokeWidth={2.25} className="text-white" />
        </div>
        <span className="font-semibold tracking-tight text-[1.0625rem]">Pulse</span>
      </Link>

      <nav className="flex flex-col gap-5 flex-1">
        {NAV_DESKTOP_SECTIONS.map((section, idx) => (
          <div key={idx} className="flex flex-col gap-1">
            {section.label && (
              <div className="px-3 mb-1 eyebrow !text-[10px]">{section.label}</div>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={new RegExp(item.match).test(pathname)}
                  badge={item.href === "/alarms" && alarmCount > 0 ? alarmCount : undefined}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-3 py-2 rounded-[var(--radius-chip)] bg-[var(--color-surface)] border border-[var(--color-border)] text-caption flex items-center justify-between">
        <span className="text-subtle">Quick log</span>
        <kbd className="num-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
          ⌘K
        </kbd>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
  badge,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
}) {
  return (
    <li>
      <Link
        href={item.href}
        className={cn(
          "relative flex items-center gap-3 px-3 h-9 rounded-[var(--radius-chip)] text-[0.875rem] transition-colors duration-200",
          active
            ? "text-[var(--color-text)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/50",
        )}
      >
        {active && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute inset-0 rounded-[var(--radius-chip)] bg-[var(--color-surface)] border border-[var(--color-border)]"
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <span className="relative z-10 flex items-center gap-3 w-full">
          <Glyph name={item.icon as GlyphName} size={16} />
          <span className="flex-1">{item.label}</span>
          {badge != null && (
            <span className="ml-auto rounded-full bg-[var(--color-tier-s2)]/20 text-[var(--color-tier-s2)] num-mono text-[10px] px-1.5 leading-4">
              {badge}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
