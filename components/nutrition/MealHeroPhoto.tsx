"use client";

/**
 * Hero photo for the meal detail page. Handles three states:
 *   1. pending  → shimmer overlay + sparkles glyph
 *   2. no photo → rose-amber gradient with pen-line glyph (text-only meal)
 *   3. photo    → object-cover image with an onError fallback into (2)
 *
 * Kept as a tiny client island so the surrounding server component can stay
 * server-rendered. No props are reactive — file is set once at mount.
 */

import { useState } from "react";
import { Glyph } from "@/components/ui/glyph";

export function MealHeroPhoto({
  photoPath,
  alt,
  pending,
}: {
  photoPath: string | null;
  alt: string;
  pending: boolean;
}) {
  const [errored, setErrored] = useState(false);

  if (pending) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 skeleton opacity-80" />
        <div className="absolute inset-0 grid place-items-center">
          <Glyph
            name="Sparkles"
            size={42}
            className="text-[var(--color-nutrition)] animate-pulse"
          />
        </div>
      </div>
    );
  }

  if (!photoPath || errored) {
    return (
      <div
        className="absolute inset-0 grid place-items-center"
        style={{
          background:
            "radial-gradient(ellipse 100% 100% at 30% 20%, hsl(346 36% 24% / 0.6), hsl(36 36% 16% / 0.5))",
        }}
      >
        <Glyph
          name="PenLine"
          size={36}
          className="text-[var(--color-nutrition)] opacity-60"
        />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoPath}
      alt={alt}
      onError={() => setErrored(true)}
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
