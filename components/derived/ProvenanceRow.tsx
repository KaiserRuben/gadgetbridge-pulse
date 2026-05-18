"use client";

import { useState } from "react";

import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import type { ProvenanceSource, ProvenanceTag } from "@/runner/jobs/types";

/**
 * Per-field provenance strip rendered underneath (or alongside) a derived
 * payload. Two surfaces consume this:
 *
 *  - The collapsed `<ProvenanceChip>` (OQ-1 default everywhere) opens an
 *    inline version below the chip when toggled. It passes `showPrefix=false`
 *    to keep the disclosure visually flat.
 *  - The always-visible row used by synthesis cells. Also runs with
 *    `showPrefix=false` post-U2 — the "Quellen" prefix was footer-disclaimer-
 *    coded, and the pill row reads cleaner without it.
 *
 * Tags arriving from the JobCell route are grouped by `source`. Each unique
 * source becomes one pill; tapping opens a per-source inspector overlay with
 * field paths, captured timestamps, external IDs and any source-specific
 * extras (photo thumbnails, rule logic, revision IDs). All sources are
 * inspectable as of U2 — earlier scaffolding gated the inspector to
 * `vlm_inferred` / `external_db` only.
 */

/** Including external_db ahead of the grounding rewrite landing it. */
type AnySource = ProvenanceSource | "external_db";

const LABEL_DE: Record<AnySource, string> = {
  wearable_sensor: "Wearable",
  user_input: "Eigeneingabe",
  vlm_inferred: "Kamera-KI",
  llm_derived: "KI-Berechnung",
  rule_computed: "Regelbasiert",
  user_edited: "Bearbeitet",
  seed_data: "Referenzwert",
  manual_log: "Manuell",
  external_db: "Datenbank",
};

const TONE_BY_SOURCE: Record<AnySource, "neutral" | "low" | "nutrition" | "activity" | "sleep" | "heart" | "up"> = {
  wearable_sensor: "sleep",
  user_input: "neutral",
  vlm_inferred: "nutrition",
  llm_derived: "activity",
  rule_computed: "low",
  user_edited: "up",
  seed_data: "low",
  manual_log: "neutral",
  external_db: "heart",
};

interface SourceGroup {
  source: AnySource;
  tags: ProvenanceTag[];
}

function groupBySource(tags: ProvenanceTag[]): SourceGroup[] {
  const buckets = new Map<AnySource, ProvenanceTag[]>();
  for (const t of tags) {
    const src = t.source as AnySource;
    if (!buckets.has(src)) buckets.set(src, []);
    buckets.get(src)!.push(t);
  }
  return Array.from(buckets.entries()).map(([source, tags]) => ({
    source,
    tags,
  }));
}

export function ProvenanceRow({
  tags,
  className,
  showPrefix = false,
}: {
  tags: ProvenanceTag[];
  className?: string;
  /**
   * When true, prepend a "Quellen" caps label. Defaults to false (U2
   * polish — both consumer surfaces want the cleaner pill-only layout).
   */
  showPrefix?: boolean;
}) {
  const [inspect, setInspect] = useState<{ source: AnySource; tags: ProvenanceTag[] } | null>(null);
  if (!tags || tags.length === 0) return null;
  const groups = groupBySource(tags);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-caption text-subtle",
        className,
      )}
    >
      {showPrefix && (
        <span className="text-faint text-[10px] uppercase tracking-[0.08em] mr-1">
          Quellen
        </span>
      )}
      {groups.map((g) => {
        const label = LABEL_DE[g.source] ?? g.source;
        const tone = TONE_BY_SOURCE[g.source] ?? "neutral";
        const fields = g.tags.map((t) => t.field_path).join(", ");
        const earliestCaptured = g.tags
          .map((t) => t.captured_at)
          .filter((x): x is string => !!x)
          .sort()[0];
        const titleText = `${label} · ${g.tags.length} Feld${g.tags.length > 1 ? "er" : ""}: ${fields}${
          earliestCaptured ? ` · ${earliestCaptured}` : ""
        }`;

        return (
          <button
            key={g.source}
            type="button"
            onClick={() => setInspect({ source: g.source, tags: g.tags })}
            title={titleText}
            className="inline-flex transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-strong)] rounded-[var(--radius-pill)]"
          >
            <Pill tone={tone} size="sm">
              {label}
              {g.tags.length > 1 && (
                <span className="ml-1 text-faint num-mono">·{g.tags.length}</span>
              )}
            </Pill>
          </button>
        );
      })}
      {inspect && (
        <ProvenanceInspector
          source={inspect.source}
          tags={inspect.tags}
          onClose={() => setInspect(null)}
        />
      )}
    </div>
  );
}

/**
 * Per-source modal content. Architected to gracefully degrade when the
 * deeper data the modal *could* show (photo thumbnails, rule-logic text,
 * revision IDs) isn't wired yet — we surface what's on the `ProvenanceTag`
 * and leave the richer shapes for future phases.
 */
function ProvenanceInspector({
  source,
  tags,
  onClose,
}: {
  source: AnySource;
  tags: ProvenanceTag[];
  onClose: () => void;
}) {
  const label = LABEL_DE[source] ?? source;
  const tone = TONE_BY_SOURCE[source] ?? "neutral";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="surface w-full max-w-md rounded-[var(--radius-card)] p-5 m-4 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
        <header className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-title">Provenienz</h3>
            <Pill tone={tone} size="sm">{label}</Pill>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-[var(--color-text)] text-caption"
          >
            Schließen
          </button>
        </header>

        <SourceContextBlock source={source} tags={tags} />

        <div className="flex flex-col gap-3">
          {tags.map((tag, i) => (
            <TagInspector key={`${tag.field_path}-${i}`} tag={tag} source={source} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Top-of-modal contextual blurb that explains what the source *is* before
 * we list its individual tags. Keeps the inspector from reading like a
 * raw debug dump.
 */
function SourceContextBlock({
  source,
  tags,
}: {
  source: AnySource;
  tags: ProvenanceTag[];
}): React.ReactNode {
  switch (source) {
    case "wearable_sensor":
      return (
        <p className="text-caption text-muted leading-snug">
          Rohdaten vom Wearable. Werte werden aus dem
          {" "}
          <span className="num-mono">HUAWEI_ACTIVITY_SAMPLE</span>
          {" "}
          Tabellen-Export gelesen und unverändert übernommen.
        </p>
      );
    case "vlm_inferred":
      return (
        <p className="text-caption text-muted leading-snug">
          Aus Mahlzeit-Foto rekonstruiert. Vision-LLM (qwen3-VL) bestimmt
          Komponenten + Mengen anhand des Bildes. Konfidenz unten je Feld.
        </p>
      );
    case "llm_derived":
      return (
        <p className="text-caption text-muted leading-snug">
          Vom Sprachmodell abgeleitet. Reasoning-Traces erscheinen, sobald
          die Cluster sie persistent ablegen — derzeit nur Feldpfad +
          erfasste Zeit.
        </p>
      );
    case "rule_computed":
      return (
        <p className="text-caption text-muted leading-snug">
          Aus Regeln berechnet (kein LLM). Die Regel-Logik wird in einer
          späteren Phase mitgelesen — heute reicht der Regel-Anker im
          Feldpfad.
        </p>
      );
    case "user_edited":
      return (
        <p className="text-caption text-muted leading-snug">
          Manuell bearbeitet. Die Revisionshistorie liegt in der Meal-
          Detail-Ansicht; hier zeigen wir wann + welches Feld zuletzt
          verändert wurde.
        </p>
      );
    case "seed_data":
      return (
        <p className="text-caption text-muted leading-snug">
          Profil-Voreinstellung. Werte aus dem Onboarding bzw. den
          Settings, bevor Wearable-Daten vorlagen.
        </p>
      );
    case "manual_log":
      return (
        <p className="text-caption text-muted leading-snug">
          Manuell geloggt. Der Log-Eintrag-Zeitstempel steht je Feld
          unten.
        </p>
      );
    case "external_db":
      return (
        <p className="text-caption text-muted leading-snug">
          Externe Datenbank-Quelle. Externe IDs sind zur Rückverfolgung
          unten verlinkt.
        </p>
      );
    case "user_input":
      return (
        <p className="text-caption text-muted leading-snug">
          Eigeneingabe — beim Logging direkt eingegeben.
        </p>
      );
    default:
      return null;
  }
  void tags;
}

function TagInspector({
  tag,
  source,
}: {
  tag: ProvenanceTag;
  source: AnySource;
}): React.ReactNode {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 flex flex-col gap-2">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        <dt className="text-subtle">Feld</dt>
        <dd className="num-mono break-all">{tag.field_path}</dd>

        {tag.captured_at && (
          <>
            <dt className="text-subtle">{labelForCapturedAt(source)}</dt>
            <dd className="num-mono">{formatCapturedAt(tag.captured_at)}</dd>
          </>
        )}

        {tag.external_id && (
          <>
            <dt className="text-subtle">{labelForExternalId(source)}</dt>
            <dd className="num-mono break-all">{tag.external_id}</dd>
          </>
        )}

        {typeof tag.confidence === "number" && (
          <>
            <dt className="text-subtle">Konfidenz</dt>
            <dd className="num-mono">{(tag.confidence * 100).toFixed(0)}%</dd>
          </>
        )}
      </dl>

      <SourceExtraDetail source={source} tag={tag} />
    </div>
  );
}

function SourceExtraDetail({
  source,
  tag,
}: {
  source: AnySource;
  tag: ProvenanceTag;
}): React.ReactNode {
  switch (source) {
    case "wearable_sensor": {
      const huaweiTable = inferHuaweiTable(tag.field_path);
      if (!huaweiTable) return null;
      return (
        <p className="text-caption text-subtle">
          Tabellen-Referenz:
          {" "}
          <span className="num-mono">{huaweiTable}</span>
        </p>
      );
    }
    case "vlm_inferred":
      // Photo thumbnail not wired yet — graceful no-op. External ID is
      // the photo_id, already surfaced above.
      return null;
    case "llm_derived":
      // Reasoning-trace excerpt not on ProvenanceTag yet.
      return null;
    case "rule_computed":
      // rule_id + rule logic text — once the cluster surfaces them, the
      // tag.external_id will carry rule_id and we can resolve text here.
      if (tag.external_id) {
        return (
          <p className="text-caption text-subtle">
            Regel-ID:
            {" "}
            <span className="num-mono">{tag.external_id}</span>
          </p>
        );
      }
      return null;
    case "user_edited":
      // Revision link: when the meal-detail surface starts emitting
      // revision IDs as external_id, we'd render a link here. Today the
      // basic field_path + captured_at carries enough signal.
      return null;
    case "seed_data":
      // Surface seed source text when present — falls back to "Profil-
      // Voreinstellung" copy in the source-context block above.
      return null;
    case "manual_log":
      return null;
    case "external_db":
      return null;
    default:
      return null;
  }
}

function labelForCapturedAt(source: AnySource): string {
  switch (source) {
    case "wearable_sensor": return "Erfasst";
    case "vlm_inferred": return "Foto-Zeit";
    case "llm_derived": return "Berechnet";
    case "rule_computed": return "Berechnet";
    case "user_edited": return "Bearbeitet";
    case "manual_log": return "Geloggt";
    default: return "Zeit";
  }
}

function labelForExternalId(source: AnySource): string {
  switch (source) {
    case "vlm_inferred": return "Foto-ID";
    case "rule_computed": return "Regel-ID";
    case "user_edited": return "Revision";
    case "external_db": return "Externe ID";
    default: return "Externe ID";
  }
}

/**
 * Best-effort HUAWEI table inference from a field_path. The runner's
 * wearable shim currently uses paths like `huawei.activity_sample.*` so a
 * prefix match is enough until provenance carries the table name itself.
 */
function inferHuaweiTable(fieldPath: string): string | null {
  if (fieldPath.includes("activity_sample")) return "HUAWEI_ACTIVITY_SAMPLE";
  if (fieldPath.includes("workout")) return "HUAWEI_WORKOUT_SUMMARY";
  if (fieldPath.includes("sleep")) return "HUAWEI_SLEEP_*";
  if (fieldPath.includes("heart") || fieldPath.includes("hr")) return "HUAWEI_HEART_RATE_*";
  return null;
}

function formatCapturedAt(iso: string): string {
  // Defensive: server might pass already-localised strings. Try to render
  // de-DE if it parses as ISO, otherwise pass through.
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
}
