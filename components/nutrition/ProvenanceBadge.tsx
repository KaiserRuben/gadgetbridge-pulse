"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import type { MealComponentProvenance } from "@/lib/nutrition/types";
import { cn } from "@/lib/cn";

/**
 * Per-component provenance badge for the meal-review form. Reads the
 * `nutrition.per100g` tag (the most user-meaningful "where do the kcal come
 * from") and renders a compact pill. Click expands an inspector row showing
 * identity + nutrition trails.
 *
 * `external_id` is namespaced upstream by `enrich.ts` (`usda:` / `off:`) so
 * the dashboard can tell USDA from OFF after the `ProvenanceSource` enum
 * squashes both to `external_db`. Untagged ids fall through to a generic
 * "DB" label.
 */

type Source = MealComponentProvenance["source"];

type Display = {
  label: string;
  tone: Parameters<typeof Pill>[0]["tone"];
  icon: "Sparkles" | "Camera" | "Database" | "PenLine" | "Compass" | "Gauge" | "Activity";
};

function nutritionTag(tags: MealComponentProvenance[] | undefined) {
  if (!tags) return undefined;
  return tags.find((t) => t.field_path === "nutrition.per100g");
}

function identityTag(tags: MealComponentProvenance[] | undefined) {
  if (!tags) return undefined;
  return tags.find((t) => t.field_path === "identity");
}

function externalNs(externalId: string | undefined): "usda" | "off" | null {
  if (!externalId) return null;
  if (externalId.startsWith("usda:")) return "usda";
  if (externalId.startsWith("off:")) return "off";
  return null;
}

function strippedExternalId(externalId: string | undefined): string | undefined {
  if (!externalId) return undefined;
  const colon = externalId.indexOf(":");
  return colon === -1 ? externalId : externalId.slice(colon + 1);
}

function displayFor(source: Source, externalId?: string): Display {
  switch (source) {
    case "seed_data":
      return { label: "Saat-DB", tone: "steady", icon: "Database" };
    case "external_db": {
      const ns = externalNs(externalId);
      if (ns === "usda") return { label: "USDA", tone: "low", icon: "Database" };
      if (ns === "off") return { label: "Open Food Facts", tone: "low", icon: "Compass" };
      return { label: "Externe DB", tone: "low", icon: "Database" };
    }
    case "llm_derived":
      return { label: "LLM", tone: "s3", icon: "Sparkles" };
    case "vlm_inferred":
      return { label: "Bild", tone: "nutrition", icon: "Camera" };
    case "user_input":
    case "user_edited":
    case "manual_log":
      return { label: "manuell", tone: "up", icon: "PenLine" };
    case "rule_computed":
      return { label: "Regel", tone: "neutral", icon: "Gauge" };
    case "wearable_sensor":
      return { label: "Sensor", tone: "neutral", icon: "Activity" };
  }
}

export function ProvenanceBadge({
  tags,
  className,
}: {
  tags: MealComponentProvenance[] | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const nutrition = nutritionTag(tags);
  const identity = identityTag(tags);

  if (!nutrition && !identity) return null;

  const primary = nutrition ?? identity!;
  const disp = displayFor(primary.source, primary.external_id);

  return (
    <div className={cn("inline-flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex"
        aria-expanded={open}
        aria-label="Quelle anzeigen"
      >
        <Pill tone={disp.tone} size="sm" className="gap-1">
          <Glyph name={disp.icon} size={10} />
          {disp.label}
        </Pill>
      </button>

      {open && (
        <ul className="text-[0.6875rem] text-subtle num-mono leading-[1.5] flex flex-col gap-0.5 pl-1 border-l border-[var(--color-border)]">
          {identity && (
            <li>
              <span className="text-faint">Erkennung: </span>
              <span>{displayFor(identity.source).label}</span>
              {typeof identity.confidence === "number" && (
                <span className="text-faint"> · {(identity.confidence * 100).toFixed(0)}%</span>
              )}
            </li>
          )}
          {nutrition && (
            <li>
              <span className="text-faint">Nährwerte: </span>
              <span>{displayFor(nutrition.source, nutrition.external_id).label}</span>
              {nutrition.external_id && (
                <span className="text-faint">
                  {" · "}
                  {strippedExternalId(nutrition.external_id)}
                </span>
              )}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
