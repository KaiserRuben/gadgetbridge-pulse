"use client";

/**
 * Photo gallery for the meal detail page.
 *
 * Renders the cover photo at full width, with a thumbnail strip below for
 * extra photos (nutrition label, packaging, context). Clicking a thumbnail
 * swaps the active photo. Single-photo meals collapse to the hero-only
 * layout — the strip is hidden.
 *
 * Stays a client island so the surrounding page can render server-side.
 */

import { useState } from "react";
import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { mealPhotoUrlAt } from "@/lib/nutrition/helpers";

interface GalleryPhoto {
  ord: number;
  kind: "meal" | "label" | "context" | null;
}

const KIND_LABEL_DE: Record<"meal" | "label" | "context", string> = {
  meal: "Essen",
  label: "Label",
  context: "Kontext",
};

export function MealPhotoGallery({
  mealId,
  photos,
  altBase,
  pending,
}: {
  mealId: string;
  photos: GalleryPhoto[];
  altBase: string;
  pending: boolean;
}) {
  const [errored, setErrored] = useState<Record<number, boolean>>({});
  const [active, setActive] = useState<number>(0);

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

  if (photos.length === 0) {
    return (
      <div
        className="absolute inset-0 grid place-items-center"
        style={{
          background:
            "radial-gradient(ellipse 100% 100% at 30% 20%, color-mix(in srgb, var(--color-nutrition) 40%, var(--color-bg)), color-mix(in srgb, var(--color-nutrition-2) 24%, var(--color-bg)))",
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

  const activePhoto = photos.find((p) => p.ord === active) ?? photos[0];
  const isErrored = errored[activePhoto.ord];

  return (
    <>
      {isErrored ? (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{
            background:
              "radial-gradient(ellipse 100% 100% at 30% 20%, color-mix(in srgb, var(--color-nutrition) 40%, var(--color-bg)), color-mix(in srgb, var(--color-nutrition-2) 24%, var(--color-bg)))",
          }}
        >
          <Glyph
            name="AlertTriangle"
            size={32}
            className="text-[var(--color-nutrition)] opacity-60"
          />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mealPhotoUrlAt(mealId, activePhoto.ord)}
          alt={`${altBase} (${activePhoto.kind ?? "Bild"} ${activePhoto.ord + 1})`}
          onError={() => setErrored((m) => ({ ...m, [activePhoto.ord]: true }))}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {photos.length > 1 && (
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3 pointer-events-none">
          <div className="flex gap-2 pointer-events-auto overflow-x-auto max-w-[60%]">
            {photos.map((p) => {
              const isActive = p.ord === activePhoto.ord;
              return (
                <button
                  key={p.ord}
                  type="button"
                  onClick={() => setActive(p.ord)}
                  className={cn(
                    "relative size-12 shrink-0 rounded-[var(--radius-chip)] overflow-hidden border-2 transition-colors",
                    isActive
                      ? "border-[var(--color-nutrition)]"
                      : "border-white/30 hover:border-white/60",
                  )}
                  aria-label={`Bild ${p.ord + 1} (${p.kind ?? "Bild"}) anzeigen`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mealPhotoUrlAt(mealId, p.ord)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {p.kind && (
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm text-[0.625rem] text-white text-center py-0.5">
                      {KIND_LABEL_DE[p.kind]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <Pill tone="low" size="sm">
            {activePhoto.ord + 1}/{photos.length}
            {activePhoto.kind ? ` · ${KIND_LABEL_DE[activePhoto.kind]}` : ""}
          </Pill>
        </div>
      )}
    </>
  );
}
