"use client";

/**
 * Modal/sheet variant of the capture flow. Can be opened from anywhere
 * (sidebar quick-log, day page, etc.). Mirrors the full /nutrition/log
 * page but in a slide-up panel.
 *
 * Per NUTRITION_PLAN deltas:
 *   - Text and photo always coexist (never an either/or toggle). Text-only
 *     submit is valid; photo-only submit is valid; both is valid.
 *   - Image format is keep-what-you-upload — accept `image/*` including
 *     HEIC. No client-side transcode.
 *   - Visual status states are surfaced after submit so the user knows
 *     the async classify hop is running.
 *
 * Wire path: POST multipart to /api/nutrition/upload → DB row created with
 * status=pending + sidecar JSON dropped in `meals/inbox/<period>/` →
 * Mac VLM watcher (chokidar) picks up sidecar → classify+enrich → POST to
 * Pi /api/ingest/meal → row moves to status=classified. We poll the meal
 * row until status is not pending, then refresh the route so the parent
 * page re-renders with the classified totals.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Glyph } from "@/components/ui/glyph";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";

export type PhotoKind = "meal" | "label" | "context";

export interface CapturePhotoSlot {
  /** Stable id only for React keys — not persisted. */
  uiKey: string;
  file: File;
  previewUrl: string;
  kind: PhotoKind;
}

export type CapturePayload = {
  /** All attached photos in submission order. Empty when text-only. */
  photos: CapturePhotoSlot[];
  text: string;
  meal_at?: string | null;
};

export type CaptureStatus =
  | "idle"
  | "uploading"
  | "classifying"
  | "classified"
  | "failed";

interface UploadResponse {
  meal_id: string;
  period_key: string;
  status: "pending" | "classified" | "failed";
  photo_path?: string | null;
  photos?: Array<{ ord: number; path: string; mime: string; kind: PhotoKind | null }>;
}

interface MealStatusResponse {
  id: string;
  status: "pending" | "classified" | "failed" | "edited";
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;
const MAX_PHOTOS = 4;

const PHOTO_KIND_LABEL_DE: Record<PhotoKind, string> = {
  meal: "Essen",
  label: "Nährwert-Label",
  context: "Kontext",
};

let _slotSeq = 0;
function nextSlotKey(): string {
  _slotSeq += 1;
  return `photo-${Date.now()}-${_slotSeq}`;
}

export function MealCaptureSheet({
  open,
  onClose,
  onSubmit,
  defaultMealAt,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit?: (p: CapturePayload) => void;
  defaultMealAt?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 grid place-items-end md:place-items-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="surface w-full md:max-w-xl md:rounded-[var(--radius-card)] rounded-t-[var(--radius-card)] p-5 md:m-4 flex flex-col gap-4 max-h-[92dvh] overflow-y-auto"
          >
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center size-8 rounded-xl bg-[hsl(346_40%_18%)] border border-[hsl(346_36%_28%)] text-[var(--color-nutrition)]">
                  <Glyph name="Camera" size={14} />
                </span>
                <div className="flex flex-col">
                  <Eyebrow>Mahlzeit</Eyebrow>
                  <span className="text-title">Foto, Text oder beides</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-faint hover:text-[var(--color-text)] transition-colors"
                aria-label="Schließen"
              >
                <Glyph name="ChevronRight" size={18} className="rotate-90 md:rotate-0" />
              </button>
            </header>

            <CaptureBody onSubmit={onSubmit} onClose={onClose} defaultMealAt={defaultMealAt} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CaptureBody({
  onSubmit,
  onClose,
  defaultMealAt,
  large,
}: {
  onSubmit?: (p: CapturePayload) => void;
  onClose?: () => void;
  defaultMealAt?: string;
  large?: boolean;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<CapturePhotoSlot[]>([]);
  const [text, setText] = useState("");
  const [mealAt, setMealAt] = useState<string>(defaultMealAt ?? "");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  function appendFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files);
    setPhotos((prev) => {
      const next = [...prev];
      for (const f of arr) {
        if (next.length >= MAX_PHOTOS) break;
        // First photo defaults to "meal", subsequent to "label" (so a single
        // tap on label after the food shot is the common path). User can
        // change either via the kind selector below the thumbnail.
        const defaultKind: PhotoKind = next.length === 0 ? "meal" : "label";
        next.push({
          uiKey: nextSlotKey(),
          file: f,
          previewUrl: URL.createObjectURL(f),
          kind: defaultKind,
        });
      }
      return next;
    });
  }

  function removePhoto(uiKey: string) {
    setPhotos((prev) => {
      const hit = prev.find((p) => p.uiKey === uiKey);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.uiKey !== uiKey);
    });
  }

  function setPhotoKind(uiKey: string, kind: PhotoKind) {
    setPhotos((prev) => prev.map((p) => (p.uiKey === uiKey ? { ...p, kind } : p)));
  }

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      pollAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset transient status when the user mutates inputs after a failure.
  useEffect(() => {
    if (status === "failed" && (photos.length > 0 || text)) {
      setStatus("idle");
      setErrorMsg(null);
    }
  }, [photos, text, status]);

  const canSubmit =
    (photos.length > 0 || text.trim().length > 0) &&
    status !== "uploading" &&
    status !== "classifying";

  const busy = status === "uploading" || status === "classifying";
  const canAddMore = photos.length < MAX_PHOTOS;

  async function pollUntilClassified(mealId: string, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) return;
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (signal.aborted) return;
      const res = await fetch(`/api/nutrition/meal/${mealId}`, {
        signal,
        cache: "no-store",
      }).catch((err) => {
        // Network error during a poll: surface and stop. Don't bury — the
        // Mac VLM hop is the slowest part of the flow and silent retry hides
        // real issues (e.g. INGEST_BASE_URL unset on the runner).
        throw err;
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const body = (await res.json()) as { meal?: MealStatusResponse };
      const s = body.meal?.status;
      if (s === "classified" || s === "edited") return;
      if (s === "failed") throw new Error("classification failed");
    }
    throw new Error("classification timed out — Mac runner offline or backlog");
  }

  async function handleUpload() {
    setErrorMsg(null);
    setStatus("uploading");
    onSubmit?.({ photos, text: text.trim(), meal_at: mealAt || null });

    const form = new FormData();
    // Repeated `images` field for the photos[]; per-photo `kind_<i>` hints
    // so the upload route can persist the user-chosen photo type.
    photos.forEach((p, idx) => {
      form.append("images", p.file);
      form.set(`kind_${idx}`, p.kind);
    });
    if (text.trim()) form.set("text", text.trim());
    if (mealAt) {
      // <input type="datetime-local"> emits a string without a timezone
      // (e.g. "2026-05-17T13:42"). Treat as local Berlin time and let the
      // server's parseMealAt → new Date() apply the host TZ. For ISO clarity
      // append the local offset.
      const local = new Date(mealAt);
      if (!Number.isNaN(local.getTime())) {
        form.set("meal_at", local.toISOString());
      }
    }

    let uploadJson: UploadResponse;
    try {
      const res = await fetch("/api/nutrition/upload", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as UploadResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? `upload failed (${res.status})`);
      }
      uploadJson = json;
    } catch (err) {
      setStatus("failed");
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return;
    }

    // Optimistic refresh so the new pending row shows up on the parent
    // immediately, while we wait on the Mac VLM hop.
    router.refresh();
    setStatus("classifying");

    const abort = new AbortController();
    pollAbortRef.current?.abort();
    pollAbortRef.current = abort;

    try {
      await pollUntilClassified(uploadJson.meal_id, abort.signal);
      setStatus("classified");
      router.refresh();
      if (onClose) {
        setTimeout(() => onClose(), 700);
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      setStatus("failed");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        void handleUpload();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          appendFiles(e.target.files);
          // Reset so the same file can be reselected after removal.
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      {photos.length === 0 ? (
        // Empty-state dropzone — same affordance as the old single-photo
        // entry but spelling out the multi-image story.
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            appendFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "relative cursor-pointer rounded-[var(--radius-card)] border-2 border-dashed transition-colors overflow-hidden",
            large ? "min-h-[260px]" : "min-h-[180px]",
            dragging
              ? "border-[var(--color-nutrition)] bg-[hsl(346_40%_18%)]/40"
              : "border-[var(--color-border-strong)] hover:border-[var(--color-nutrition)]/40 bg-[var(--color-bg-elevated)]/40",
          )}
        >
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <Glyph
                name="ImagePlus"
                size={large ? 32 : 24}
                className="text-[var(--color-nutrition)]"
              />
              <p className="text-[0.9375rem] font-medium">
                Fotos aufnehmen oder ziehen
              </p>
              <p className="text-caption text-muted max-w-[36ch]">
                Bis zu {MAX_PHOTOS} Bilder: Essen, Nährwert-Label, Verpackung,
                Kontext. JPEG, PNG, WebP, HEIC.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {photos.map((p, idx) => (
              <div
                key={p.uiKey}
                className="relative rounded-[var(--radius-card)] overflow-hidden border border-[var(--color-border)] bg-black/20 aspect-square"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={`Foto ${idx + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => {
                    if (!busy) removePhoto(p.uiKey);
                  }}
                  disabled={busy}
                  aria-label={`Foto ${idx + 1} entfernen`}
                  className="absolute top-1.5 right-1.5 grid place-items-center size-7 rounded-full bg-black/60 backdrop-blur-sm border border-white/15 text-white hover:bg-black/80 disabled:opacity-40"
                >
                  <Glyph name="X" size={14} />
                </button>
                <div className="absolute top-1.5 left-1.5">
                  <Pill tone={idx === 0 ? "nutrition" : "low"} size="sm">
                    {idx + 1}
                  </Pill>
                </div>
                <div className="absolute bottom-1.5 left-1.5 right-1.5">
                  <select
                    value={p.kind}
                    onChange={(e) => setPhotoKind(p.uiKey, e.target.value as PhotoKind)}
                    disabled={busy}
                    className="w-full bg-black/60 backdrop-blur-sm border border-white/15 rounded-[var(--radius-chip)] text-caption text-white px-2 py-1 focus:outline-none focus:border-[var(--color-nutrition)]"
                  >
                    {(Object.keys(PHOTO_KIND_LABEL_DE) as PhotoKind[]).map((k) => (
                      <option key={k} value={k} className="bg-[var(--color-bg)] text-white">
                        {PHOTO_KIND_LABEL_DE[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {canAddMore && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="aspect-square rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border-strong)] hover:border-[var(--color-nutrition)]/60 grid place-items-center text-[var(--color-nutrition)] hover:bg-[hsl(346_40%_18%)]/30 transition-colors disabled:opacity-40"
              >
                <div className="flex flex-col items-center gap-1">
                  <Glyph name="ImagePlus" size={20} />
                  <span className="text-caption">Foto +</span>
                </div>
              </button>
            )}
          </div>
          <p className="text-caption text-subtle">
            {photos.length}/{MAX_PHOTOS} Bilder · #1 ist das Titelbild (z. B. das
            Essen), zusätzliche Aufnahmen können Nährwert-Label oder Kontext
            sein.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex items-center justify-between">
          <Eyebrow>Notiz / Mengen / Zubereitung — auch ohne Foto</Eyebrow>
          {text.length > 0 && (
            <span className="text-caption num-mono text-subtle">{text.length}/200</span>
          )}
        </label>
        <textarea
          rows={large ? 3 : 2}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          placeholder='z. B. „200 g Butter dazu“, „share-plate, ⅓ gegessen“, oder „2 Eier + Toast“ (ohne Foto)'
          disabled={busy}
          className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-chip)] px-3 py-2.5 text-[0.9375rem] resize-none focus:outline-none focus:border-[var(--color-nutrition)] placeholder:text-faint disabled:opacity-60"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Glyph name="Clock" size={14} className="text-subtle" />
          <Eyebrow>Zeit</Eyebrow>
        </div>
        <input
          type="datetime-local"
          value={mealAt}
          onChange={(e) => setMealAt(e.target.value)}
          className="num-mono text-caption bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-xs)] px-2 py-1.5 focus:outline-none focus:border-[var(--color-nutrition)]"
        />
        <span className="text-caption text-subtle">leer = jetzt</span>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        <div className="mr-auto flex flex-col gap-1">
          {status !== "idle" && <StatusPill status={status} hasFile={photos.length > 0} />}
          {errorMsg && status === "failed" && (
            <span className="text-caption text-[var(--color-warn,#b76e00)] max-w-[40ch]">
              {errorMsg}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-caption text-muted hover:text-[var(--color-text)] px-3 py-2 transition-colors disabled:opacity-40"
          >
            Abbrechen
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 text-[0.875rem] font-medium px-4 py-2 rounded-[var(--radius-chip)] bg-[var(--color-nutrition)] text-[var(--color-bg)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Glyph name={status === "classified" ? "CheckCircle" : "Upload"} size={14} />
          {status === "uploading"
            ? "Hochladen …"
            : status === "classifying"
            ? "Klassifiziere …"
            : status === "classified"
            ? "Gespeichert"
            : status === "failed"
            ? "Erneut versuchen"
            : "Hochladen & klassifizieren"}
        </button>
      </div>
    </form>
  );
}

function StatusPill({ status, hasFile }: { status: CaptureStatus; hasFile?: boolean }) {
  if (status === "idle") {
    return hasFile ? (
      <Pill tone="up" size="sm">
        <span className="animate-pulse">●</span> Bereit
      </Pill>
    ) : null;
  }
  if (status === "uploading") {
    return (
      <Pill tone="steady" size="sm">
        <span className="animate-pulse">●</span> Hochladen
      </Pill>
    );
  }
  if (status === "classifying") {
    return (
      <Pill tone="nutrition" size="sm">
        <span className="animate-pulse">●</span> Klassifiziere
      </Pill>
    );
  }
  if (status === "classified") {
    return (
      <Pill tone="up" size="sm">
        <Glyph name="CheckCircle" size={10} /> Klassifiziert
      </Pill>
    );
  }
  return (
    <Pill tone="s1" size="sm">
      <Glyph name="AlertTriangle" size={10} /> Fehlgeschlagen
    </Pill>
  );
}
