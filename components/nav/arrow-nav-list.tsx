"use client";

import { useEffect, useRef } from "react";

/**
 * Client-side keyboard wrapper for vertically-stacked link lists. Captures
 * ↑/↓ (and Vim-style j/k) when focus is inside a child anchor, moving focus
 * to the previous or next anchor in document order. Tab + Enter still work
 * unchanged. Pure DOM — no controlled state, no extra renders.
 */
export function ArrowNavList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !el!.contains(active)) return;
      if (active.tagName !== "A") return;
      const links = Array.from(el!.querySelectorAll<HTMLAnchorElement>("a"));
      const idx = links.indexOf(active as HTMLAnchorElement);
      if (idx < 0) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        links[Math.min(idx + 1, links.length - 1)]?.focus();
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        links[Math.max(idx - 1, 0)]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        links[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        links[links.length - 1]?.focus();
      }
    }

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ul ref={ref} role="list" className={className}>
      {children}
    </ul>
  );
}
