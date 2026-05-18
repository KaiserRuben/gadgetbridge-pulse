"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { NAV_PRIMARY_MOBILE, NAV_SHEET_MOBILE } from "@/lib/constants";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { cn } from "@/lib/cn";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export function BottomNav({ alarmCount = 0 }: { alarmCount?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = [...NAV_PRIMARY_MOBILE];

  // U4: 5 fast-access slots + a More drawer for the rest.
  // 6-col grid keeps the 11px slot size on 390px viewports (60px each
  // with 12px px-1.5 padding round-trip).
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-3 mb-3 rounded-2xl bg-[var(--color-surface)]/85 backdrop-blur-xl border border-[var(--color-border)] shadow-[0_18px_36px_-18px_hsl(0_0%_0%/0.6)]">
        <ul className="grid grid-cols-6 items-center px-1 py-1.5">
          {items.map((item) => {
            const active = new RegExp(item.match).test(pathname);
            return (
              <li key={item.href} className="grid place-items-center">
                <Link
                  href={item.href}
                  className={cn(
                    "relative grid place-items-center size-11 rounded-xl text-[var(--color-text-muted)]",
                    active && "text-[var(--color-text)]",
                  )}
                  aria-label={item.label}
                >
                  {active && (
                    <motion.div
                      layoutId="mobile-active"
                      className="absolute inset-0 rounded-xl bg-[var(--color-surface-2)]"
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}
                  <span className="relative z-10">
                    <Glyph name={item.icon as GlyphName} size={18} />
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="grid place-items-center">
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <Dialog.Trigger asChild>
                <button
                  className="relative grid place-items-center size-11 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  aria-label="Mehr"
                >
                  <Glyph name="Compass" size={18} />
                  {alarmCount > 0 && (
                    <span className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--color-tier-s2)] ring-2 ring-[var(--color-surface)]" />
                  )}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
                <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-[var(--color-surface)] border-t border-[var(--color-border)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4">
                  <Dialog.Title className="sr-only">Mehr</Dialog.Title>
                  <div className="mx-auto h-1 w-10 rounded-full bg-[var(--color-border-strong)] mb-4" />
                  <div className="grid grid-cols-3 gap-2">
                    {NAV_SHEET_MOBILE.map((item) => {
                      const active = new RegExp(item.match).test(pathname);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className={cn(
                            "flex flex-col items-center gap-2 px-3 py-4 rounded-2xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)]",
                            active && "border-[var(--color-border-strong)] text-[var(--color-text)]",
                          )}
                        >
                          <Glyph name={item.icon as GlyphName} size={20} />
                          <span className="text-[0.75rem]">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </li>
        </ul>
      </div>
    </nav>
  );
}
