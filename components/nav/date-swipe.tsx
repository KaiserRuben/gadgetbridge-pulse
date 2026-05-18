"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Horizontal-swipe-to-navigate-day wrapper. Mounts a single window-level
 * touch listener while this component is in the tree. Swipe-left → next
 * day, swipe-right → previous day.
 *
 * Why a window listener and not a wrapping div with onTouchStart: the
 * domain pages have nested scroll regions (charts, tables) whose own
 * gesture handlers would absorb the touch before a div handler fired.
 * Listening at the window catches everything; vertical-drift rejection
 * (`abs(dx) > 2 * abs(dy)`) keeps the normal page scroll un-hijacked.
 *
 * Recognition thresholds:
 *   - min horizontal travel: 60px (filters thumb wobble)
 *   - vertical-drift cap: dx must dominate dy by 2× (filters scroll)
 *   - time budget: 500ms (filters slow drags / accidental taps)
 *
 * Rendered as a render-prop-style invisible child slot — the caller
 * still owns the page layout, this component only attaches the
 * listener.
 */

const SWIPE_MIN_X = 60;
const SWIPE_DY_DOMINANCE = 2;
const SWIPE_MAX_MS = 500;

export function DateSwipe({
  prevHref,
  nextHref,
}: {
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = performance.now();
      tracking = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = performance.now() - startT;
      if (dt > SWIPE_MAX_MS) return;
      if (Math.abs(dx) < SWIPE_MIN_X) return;
      if (Math.abs(dx) < SWIPE_DY_DOMINANCE * Math.abs(dy)) return;
      // Ignore swipes that originated inside an obvious horizontal-scroll
      // container (charts, tables). The target chain at touchstart isn't
      // easily inspectable here, so we cap via a data attribute opt-out:
      // any element ancestor with `data-no-swipe` blocks navigation.
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-no-swipe]")) return;
      if (dx < 0) {
        router.push(nextHref);
      } else {
        router.push(prevHref);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [prevHref, nextHref, router]);

  return null;
}
