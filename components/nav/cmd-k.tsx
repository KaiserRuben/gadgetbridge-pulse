"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Glyph } from "@/components/ui/glyph";
import { NAV_DESKTOP_SECTIONS } from "@/lib/constants";
import { EXPLORE_METRICS } from "@/lib/explore-metrics-defs";

const QUICK_ACTIONS = [
  { href: "/log/weight", label: "Gewicht eintragen", icon: "PenLine" },
  { href: "/log/feel", label: "Stimmung loggen", icon: "Sparkles" },
  { href: "/log/journal", label: "Tagebuch-Eintrag", icon: "PenLine" },
  { href: "/workouts", label: "Trainings ansehen", icon: "Dumbbell" },
] as const;

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // Character-by-character order-preserving match.
  let i = 0;
  for (const c of h) {
    if (c === n[i]) i += 1;
    if (i === n.length) return true;
  }
  return false;
}

export function CommandKTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="flex items-center gap-2 h-9 px-2.5 rounded-[var(--radius-chip)] text-[0.8125rem] text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] transition-colors">
          <Glyph name="Command" size={14} />
          <span className="hidden sm:inline">Suchen</span>
          <kbd className="num-mono text-[10px] px-1 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] hidden sm:inline">⌘K</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[10%] sm:top-[20%] -translate-x-1/2 z-50 w-[94vw] min-w-[280px] max-w-[560px] rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-[var(--shadow-pop)] data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <Dialog.Title className="sr-only">Befehlspalette</Dialog.Title>
          <CmdKBody onClose={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CmdKBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const allRoutes = NAV_DESKTOP_SECTIONS.flatMap((s) => s.items);
  const routes = q ? allRoutes.filter((r) => fuzzyMatch(r.label, q)) : allRoutes;
  const actions = q ? QUICK_ACTIONS.filter((a) => fuzzyMatch(a.label, q)) : QUICK_ACTIONS;
  const metrics = q
    ? EXPLORE_METRICS.filter((m) => fuzzyMatch(`${m.label} ${m.id}`, q)).slice(0, 8)
    : [];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-[var(--color-border)]">
        <Glyph name="Command" size={16} className="text-subtle" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Springe zu einer Seite oder logge schnell"
          className="flex-1 bg-transparent outline-none text-[0.9375rem] placeholder:text-[var(--color-text-faint)]"
        />
        <kbd className="num-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">esc</kbd>
      </div>
      <div className="max-h-[60vh] overflow-y-auto py-2">
        {actions.length > 0 && (
          <Group label="Schnell-Log">
            {actions.map((a) => (
              <Item
                key={a.href}
                onSelect={() => {
                  router.push(a.href);
                  onClose();
                }}
                icon={a.icon}
                label={a.label}
              />
            ))}
          </Group>
        )}
        {routes.length > 0 && (
          <Group label="Springe zu">
            {routes.map((r) => (
              <Item
                key={r.href}
                onSelect={() => {
                  router.push(r.href);
                  onClose();
                }}
                icon={r.icon}
                label={r.label}
                shortcut={r.href === "/" ? "Home" : undefined}
              />
            ))}
          </Group>
        )}
        {metrics.length > 0 && (
          <Group label="Metriken">
            {metrics.map((m) => (
              <Item
                key={m.id}
                onSelect={() => {
                  router.push(`/explore/${m.id}`);
                  onClose();
                }}
                icon="LineChart"
                label={`${m.label}${m.unit ? ` (${m.unit})` : ""}`}
                shortcut={m.domain}
              />
            ))}
          </Group>
        )}
        {q && routes.length === 0 && actions.length === 0 && metrics.length === 0 && (
          <div className="px-4 py-6 text-caption text-center">Keine Treffer für „{q}".</div>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-1">
      <div className="px-2 py-1 eyebrow !text-[10px]">{label}</div>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

function Item({
  onSelect,
  icon,
  label,
  shortcut,
}: {
  onSelect: () => void;
  icon: string;
  label: string;
  shortcut?: string;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-3 px-3 h-10 rounded-[var(--radius-chip)] text-[0.875rem] hover:bg-[var(--color-surface-2)]/70 focus:bg-[var(--color-surface-2)] outline-none"
      >
        <Glyph name={icon as never} size={15} className="text-subtle" />
        <span className="flex-1 text-left">{label}</span>
        {shortcut && <span className="text-caption">{shortcut}</span>}
      </button>
    </li>
  );
}
