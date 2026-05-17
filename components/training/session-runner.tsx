"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";

import type {
  TrainingExerciseV1,
  TrainingPainFlagV1,
} from "@/lib/types/generated";
import type { SetLogRow } from "@/lib/training/set-log";
import type { PainFlagRow } from "@/lib/training/pain";
import type { SessionRow } from "@/lib/training/session";

type PrescriptionItem = {
  exercise: TrainingExerciseV1;
  prescription: {
    sets?: number | null;
    reps_min?: number | null;
    reps_max?: number | null;
    reps_per_side?: boolean;
    load_kg_min?: number | null;
    load_kg_max?: number | null;
    load_note?: string | null;
    duration_sec?: number | null;
    distance_m?: number | null;
    rpe_target?: number | null;
    rest_sec?: number | null;
  };
  notes: string | null;
  order_idx: number;
  warmup_only: boolean;
};

const PAIN_LOCATIONS: TrainingPainFlagV1["location_code"][] = [
  "back",
  "shoulder",
  "elbow",
  "wrist",
  "thumb",
  "hip",
  "knee",
  "ankle",
  "foot",
  "neck",
  "head",
  "chest",
  "abdominal",
  "other",
];

const LOCATION_LABEL_DE: Record<TrainingPainFlagV1["location_code"], string> = {
  back: "Rücken",
  shoulder: "Schulter",
  elbow: "Ellenbogen",
  wrist: "Handgelenk",
  thumb: "Daumen",
  hip: "Hüfte",
  knee: "Knie",
  ankle: "Sprunggelenk",
  foot: "Fuß",
  neck: "Nacken",
  head: "Kopf",
  chest: "Brust",
  abdominal: "Bauch",
  other: "Sonstige",
};

export interface SessionRunnerProps {
  session: SessionRow;
  templateLabel: string;
  prescribed: PrescriptionItem[];
  sets: SetLogRow[];
  pain: PainFlagRow[];
  lastTime: Record<
    string,
    Array<{
      set_idx: number;
      reps: number | null;
      weight_kg: number | null;
      duration_sec: number | null;
      rpe: number | null;
      logged_at: string;
    }>
  >;
}

interface DraftSet {
  reps: string;
  weight_kg: string;
  rpe: string;
  duration_sec: string;
  saving: boolean;
  error: string | null;
}

function fmtNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function SessionRunner(props: SessionRunnerProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const completed = props.session.state !== "in_progress";

  // Drafts: keyed by `${exercise_id}#${set_idx}`. Pre-filled from existing
  // server-side rows so the page can be reloaded mid-session without losing
  // the live numbers.
  const initial: Record<string, DraftSet> = useMemo(() => {
    const out: Record<string, DraftSet> = {};
    for (const s of props.sets) {
      out[`${s.exercise_id}#${s.set_idx}`] = {
        reps: fmtNumber(s.reps),
        weight_kg: fmtNumber(s.weight_kg),
        rpe: fmtNumber(s.rpe),
        duration_sec: fmtNumber(s.duration_sec),
        saving: false,
        error: null,
      };
    }
    return out;
  }, [props.sets]);

  const [drafts, setDrafts] = useState<Record<string, DraftSet>>(initial);
  const [activeIdx, setActiveIdx] = useState(0);
  const [painOpen, setPainOpen] = useState<string | null>(null); // exercise_id when open

  const items = props.prescribed.slice().sort((a, b) => a.order_idx - b.order_idx);

  if (items.length === 0) {
    return (
      <Card>
        <CardBody className="p-6">
          <Eyebrow>Eigene Session</Eyebrow>
          <p className="text-body text-muted mt-2">
            Diese Session hat kein festes Template — freies Logging folgt in einer
            späteren Iteration. Bis dahin: <em>End Session</em> beendet sauber.
          </p>
          <FinishButton sessionId={props.session.id} className="mt-4" />
        </CardBody>
      </Card>
    );
  }

  const active = items[Math.min(activeIdx, items.length - 1)];
  const setsForActive = (active.prescription.sets ?? 3) || 1;

  async function saveSet(exerciseId: string, setIdx: number) {
    const key = `${exerciseId}#${setIdx}`;
    const d = drafts[key];
    if (!d) return;
    setDrafts((m) => ({ ...m, [key]: { ...d, saving: true, error: null } }));
    try {
      const res = await fetch(`/api/training/session/${props.session.id}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: exerciseId,
          set_idx: setIdx,
          reps: parseNum(d.reps),
          weight_kg: parseNum(d.weight_kg),
          rpe: parseNum(d.rpe),
          duration_sec: parseNum(d.duration_sec),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDrafts((m) => ({ ...m, [key]: { ...d, saving: false, error: null } }));
      startTransition(() => router.refresh());
    } catch (err) {
      setDrafts((m) => ({
        ...m,
        [key]: { ...d, saving: false, error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  function patchDraft(key: string, patch: Partial<DraftSet>) {
    setDrafts((m) => {
      const prev = m[key] ?? {
        reps: "",
        weight_kg: "",
        rpe: "",
        duration_sec: "",
        saving: false,
        error: null,
      };
      return { ...m, [key]: { ...prev, ...patch } };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <Card glow="activity">
        <CardBody className="p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Eyebrow>Session läuft</Eyebrow>
            <Pill tone="neutral" size="sm">{props.templateLabel}</Pill>
            <Pill tone="neutral" size="sm">Plan v{props.session.plan_version}</Pill>
            {props.pain.length > 0 && (
              <Pill tone="down" size="sm">{props.pain.length} Pain-Flag</Pill>
            )}
            {completed && <Pill tone="up" size="sm">{props.session.state}</Pill>}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <ExerciseStrip
              items={items}
              activeIdx={activeIdx}
              drafts={drafts}
              setsExpected={(p) => (p.prescription.sets ?? 3) || 1}
              onPick={setActiveIdx}
            />
          </div>
        </CardBody>
      </Card>

      {/* ── Active exercise ────────────────────────────────────── */}
      <Card>
        <CardBody className="p-6 flex flex-col gap-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Glyph name="Dumbbell" size={16} className="text-muted" />
              <h2 className="text-h2">{active.exercise.display_de}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone="neutral" size="sm">{prescribeLabel(active.prescription)}</Pill>
              {active.prescription.rpe_target != null && (
                <Pill tone="steady" size="sm">RPE {active.prescription.rpe_target}</Pill>
              )}
            </div>
          </div>

          {active.notes && (
            <p className="text-caption text-muted">{active.notes}</p>
          )}

          {/* Last-time strip */}
          <LastTimeStrip rows={props.lastTime[active.exercise.id] ?? []} />

          {/* Set inputs */}
          <div className="flex flex-col gap-3">
            {Array.from({ length: setsForActive }, (_, i) => i + 1).map((setIdx) => {
              const key = `${active.exercise.id}#${setIdx}`;
              const d = drafts[key] ?? {
                reps: "",
                weight_kg: "",
                rpe: "",
                duration_sec: "",
                saving: false,
                error: null,
              };
              return (
                <SetRow
                  key={key}
                  setIdx={setIdx}
                  draft={d}
                  prescription={active.prescription}
                  onChange={(patch) => patchDraft(key, patch)}
                  onSave={() => saveSet(active.exercise.id, setIdx)}
                  disabled={completed}
                />
              );
            })}
          </div>

          {/* Mid-session actions */}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <button
              type="button"
              onClick={() => setPainOpen(active.exercise.id)}
              disabled={completed}
              className="inline-flex items-center gap-2 px-3 h-9 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-caption disabled:opacity-50"
            >
              <Glyph name="AlertTriangle" size={14} />
              Pain-Flag
            </button>
            <button
              type="button"
              onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
              disabled={activeIdx === 0}
              className="inline-flex items-center gap-2 px-3 h-9 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-caption disabled:opacity-50"
            >
              <Glyph name="ChevronLeft" size={14} />
              Zurück
            </button>
            <button
              type="button"
              onClick={() => setActiveIdx(Math.min(items.length - 1, activeIdx + 1))}
              disabled={activeIdx === items.length - 1}
              className="inline-flex items-center gap-2 px-3 h-9 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-caption disabled:opacity-50"
            >
              Nächste
              <Glyph name="ChevronRight" size={14} />
            </button>
            {!completed && <FinishButton sessionId={props.session.id} className="ml-auto" />}
          </div>
        </CardBody>
      </Card>

      {/* Pain dialog */}
      {painOpen && (
        <PainDialog
          sessionId={props.session.id}
          exerciseId={painOpen}
          onClose={() => {
            setPainOpen(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function prescribeLabel(p: PrescriptionItem["prescription"]): string {
  const sets = p.sets ?? 3;
  if (p.duration_sec != null) return `${sets} × ${p.duration_sec}s`;
  const reps =
    p.reps_min != null && p.reps_max != null && p.reps_min !== p.reps_max
      ? `${p.reps_min}–${p.reps_max}`
      : p.reps_min ?? p.reps_max ?? "?";
  const suffix = p.reps_per_side ? "/Seite" : "";
  return `${sets} × ${reps}${suffix}`;
}

function ExerciseStrip(props: {
  items: PrescriptionItem[];
  activeIdx: number;
  drafts: Record<string, DraftSet>;
  setsExpected: (p: PrescriptionItem) => number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.items.map((it, i) => {
        const expected = props.setsExpected(it);
        let done = 0;
        for (let s = 1; s <= expected; s++) {
          const d = props.drafts[`${it.exercise.id}#${s}`];
          if (d && (d.reps.trim() || d.duration_sec.trim())) done += 1;
        }
        const isActive = i === props.activeIdx;
        return (
          <button
            key={it.exercise.id}
            type="button"
            onClick={() => props.onPick(i)}
            className={[
              "px-2.5 h-8 rounded-xl text-caption transition-colors",
              "border",
              isActive
                ? "border-[var(--color-activity)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-muted",
            ].join(" ")}
          >
            {it.exercise.display_de}
            <span className="ml-1.5 num-mono text-faint">
              {done}/{expected}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SetRow(props: {
  setIdx: number;
  draft: DraftSet;
  prescription: PrescriptionItem["prescription"];
  onChange: (patch: Partial<DraftSet>) => void;
  onSave: () => void;
  disabled?: boolean;
}) {
  const usesDuration = props.prescription.duration_sec != null;
  return (
    <div className="grid grid-cols-12 items-center gap-2 p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
      <span className="num-mono text-caption col-span-1">{props.setIdx}</span>
      {usesDuration ? (
        <NumInput
          label="sek"
          colSpan={3}
          value={props.draft.duration_sec}
          onChange={(v) => props.onChange({ duration_sec: v })}
          disabled={props.disabled}
        />
      ) : (
        <NumInput
          label="Wdh"
          colSpan={3}
          value={props.draft.reps}
          onChange={(v) => props.onChange({ reps: v })}
          disabled={props.disabled}
        />
      )}
      <NumInput
        label="kg"
        colSpan={3}
        value={props.draft.weight_kg}
        onChange={(v) => props.onChange({ weight_kg: v })}
        disabled={props.disabled}
      />
      <NumInput
        label="RPE"
        colSpan={3}
        value={props.draft.rpe}
        onChange={(v) => props.onChange({ rpe: v })}
        disabled={props.disabled}
      />
      <button
        type="button"
        onClick={props.onSave}
        disabled={props.draft.saving || props.disabled}
        className="col-span-2 h-10 rounded-xl bg-[var(--color-activity)]/15 text-[var(--color-activity)] hover:bg-[var(--color-activity)]/25 disabled:opacity-50 text-caption"
        aria-label={`Satz ${props.setIdx} speichern`}
      >
        {props.draft.saving ? "…" : "Speichern"}
      </button>
      {props.draft.error && (
        <span className="col-span-12 text-caption text-[var(--color-warn,#b76e00)]">
          {props.draft.error}
        </span>
      )}
    </div>
  );
}

// Tailwind v4 purges classes it can't see as literal strings. A dynamic
// `col-span-${n}` template breaks at JIT time — the labels stacked on top
// of each other in the in-session view because of this. Use a static map.
const COL_SPAN: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
  6: "col-span-6",
  8: "col-span-8",
  12: "col-span-12",
};

function NumInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colSpan: number;
  disabled?: boolean;
}) {
  const spanCls = COL_SPAN[props.colSpan] ?? "col-span-3";
  return (
    <label className={`${spanCls} flex flex-col gap-0.5`}>
      <span className="text-faint text-[0.6875rem] uppercase tracking-wide">{props.label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className="num-mono h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[0.9375rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-activity)] disabled:opacity-60"
      />
    </label>
  );
}

function LastTimeStrip(props: {
  rows: Array<{
    set_idx: number;
    reps: number | null;
    weight_kg: number | null;
    duration_sec: number | null;
    rpe: number | null;
    logged_at: string;
  }>;
}) {
  if (props.rows.length === 0) {
    return (
      <div className="text-caption text-muted italic">Erstes Mal — keine Vergleichswerte.</div>
    );
  }
  const when = new Date(props.rows[0].logged_at).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Eyebrow>Letzte Session · {when}</Eyebrow>
      {props.rows.map((r) => (
        <Pill key={r.set_idx} tone="neutral" size="sm">
          {fmtLastSet(r)}
        </Pill>
      ))}
    </div>
  );
}

function fmtLastSet(r: {
  reps: number | null;
  weight_kg: number | null;
  duration_sec: number | null;
  rpe: number | null;
}): string {
  if (r.duration_sec != null) {
    const rpe = r.rpe != null ? ` @ ${r.rpe}` : "";
    return `${r.duration_sec}s${rpe}`;
  }
  const reps = r.reps ?? "?";
  const w = r.weight_kg != null ? ` × ${r.weight_kg}kg` : "";
  const rpe = r.rpe != null ? ` @ ${r.rpe}` : "";
  return `${reps}${w}${rpe}`;
}

function FinishButton(props: { sessionId: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [energy, setEnergy] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"completed" | "abandoned">("completed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/session/${props.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "finish",
          state,
          subjective_energy: energy,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      router.push("/training");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "inline-flex items-center gap-2 px-3 h-9 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-caption",
          props.className ?? "",
        ].join(" ")}
      >
        <Glyph name="Flag" size={14} />
        Session beenden
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 grid place-items-center px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-3">
            <h3 className="text-h3">Session beenden</h3>
            <div className="flex flex-col gap-1">
              <Eyebrow>Energie nach Session</Eyebrow>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setEnergy(v)}
                    className={[
                      "flex-1 h-10 rounded-xl border text-caption",
                      energy === v
                        ? "border-[var(--color-activity)] bg-[var(--color-surface-3)]"
                        : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
                    ].join(" ")}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Eyebrow>Notiz (optional)</Eyebrow>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[0.9375rem]"
                placeholder="Frei lassen wenn nichts zu sagen."
              />
            </div>
            <div className="flex flex-col gap-1">
              <Eyebrow>Status</Eyebrow>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setState("completed")}
                  className={[
                    "flex-1 h-10 rounded-xl border text-caption",
                    state === "completed"
                      ? "border-[var(--color-activity)] bg-[var(--color-surface-3)]"
                      : "border-[var(--color-border)]",
                  ].join(" ")}
                >
                  Abgeschlossen
                </button>
                <button
                  type="button"
                  onClick={() => setState("abandoned")}
                  className={[
                    "flex-1 h-10 rounded-xl border text-caption",
                    state === "abandoned"
                      ? "border-[var(--color-warn,#b76e00)] bg-[var(--color-surface-3)]"
                      : "border-[var(--color-border)]",
                  ].join(" ")}
                >
                  Abgebrochen
                </button>
              </div>
            </div>
            {error && (
              <p className="text-caption text-[var(--color-warn,#b76e00)]" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 h-9 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-caption"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                className="px-4 h-9 rounded-xl bg-[var(--color-activity)] text-[var(--color-bg)] hover:opacity-90 disabled:opacity-60 text-caption"
              >
                {busy ? "…" : "Speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PainDialog(props: { sessionId: string; exerciseId: string; onClose: () => void }) {
  const [location, setLocation] = useState<TrainingPainFlagV1["location_code"]>("knee");
  const [side, setSide] = useState<TrainingPainFlagV1["side"]>("left");
  const [severity, setSeverity] = useState<TrainingPainFlagV1["severity"]>("mild");
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/session/${props.sessionId}/pain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: props.exerciseId,
          location_code: location,
          side,
          severity,
          free_text: freeText.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 grid place-items-center px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-3">
        <h3 className="text-h3">Pain-Flag</h3>
        <div className="flex flex-col gap-1">
          <Eyebrow>Ort</Eyebrow>
          <div className="grid grid-cols-3 gap-1.5">
            {PAIN_LOCATIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setLocation(c)}
                className={[
                  "h-9 rounded-xl border text-caption",
                  location === c
                    ? "border-[var(--color-activity)] bg-[var(--color-surface-3)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                {LOCATION_LABEL_DE[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Seite</Eyebrow>
          <div className="grid grid-cols-4 gap-1.5">
            {(["left", "right", "bilateral", "n_a"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={[
                  "h-9 rounded-xl border text-caption",
                  side === s
                    ? "border-[var(--color-activity)] bg-[var(--color-surface-3)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                {s === "left" ? "links" : s === "right" ? "rechts" : s === "bilateral" ? "beidseits" : "—"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Intensität</Eyebrow>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setSeverity("mild")}
              className={[
                "h-10 rounded-xl border text-caption",
                severity === "mild"
                  ? "border-[var(--color-activity)] bg-[var(--color-surface-3)]"
                  : "border-[var(--color-border)]",
              ].join(" ")}
            >
              Leicht
            </button>
            <button
              type="button"
              onClick={() => setSeverity("sharp")}
              className={[
                "h-10 rounded-xl border text-caption",
                severity === "sharp"
                  ? "border-[var(--color-warn,#b76e00)] bg-[var(--color-surface-3)]"
                  : "border-[var(--color-border)]",
              ].join(" ")}
            >
              Stechend
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Notiz (frei)</Eyebrow>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={2}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[0.9375rem]"
            placeholder="z.B. „Druck am Innenmeniskus nach 2. Satz, geht in 30s weg.“"
          />
        </div>
        {error && <p className="text-caption text-[var(--color-warn,#b76e00)]">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={props.onClose}
            className="px-3 h-9 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-caption"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="px-4 h-9 rounded-xl bg-[var(--color-activity)] text-[var(--color-bg)] hover:opacity-90 disabled:opacity-60 text-caption"
          >
            {busy ? "…" : "Flaggen"}
          </button>
        </div>
      </div>
    </div>
  );
}
