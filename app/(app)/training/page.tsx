import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";

import { readActivePlan } from "@/lib/training/plan";
import { listPickerOptions, suggestTodaySession } from "@/lib/training/scheduler";
import { listSessions } from "@/lib/training/session";
import { computePainRecurrenceAlarms } from "@/lib/training/alarms";
import { listProposals } from "@/lib/training/proposal";
import { loadTrainingInsight } from "@/lib/v3-loaders";
import { StartSessionButton } from "@/components/training/start-session-button";

interface TrainingInsightShape {
  kind?: "prescription" | "post_session" | "weekly";
  headline?: string | null;
  summary?: string | null;
  prescription?: {
    suggested_session_template_id?: string | null;
    alternatives?: string[];
    justification_de?: string | null;
  } | null;
  confidence?: { value?: number };
  incomplete?: boolean;
}

export const dynamic = "force-dynamic";

function localDateKeyDe(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

function fmtRecent(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

export default async function TrainingPage() {
  noStore();
  const plan = readActivePlan();
  const now = new Date();
  const today = localDateKeyDe(now);
  const phase = plan?.payload.phases.find((p) => p.id === plan.payload.current_phase_id) ?? null;
  const insight = (await loadTrainingInsight(today)) as TrainingInsightShape | null;
  const insightUsable =
    !!insight &&
    insight.kind === "prescription" &&
    !insight.incomplete &&
    !!insight.prescription?.suggested_session_template_id;

  // Scheduler fallback when no LLM insight has landed yet. The LLM insight
  // overrides the scheduler — it has seen recovery context + pain history
  // and may have deviated from the plan's schedule_hint accordingly.
  const scheduleSuggestion = suggestTodaySession(plan?.payload ?? null, { now });
  const suggestedTemplateId =
    insightUsable && insight?.prescription?.suggested_session_template_id
      ? insight.prescription.suggested_session_template_id
      : scheduleSuggestion.kind === "session_template"
        ? scheduleSuggestion.session_template_id
        : null;
  const suggestedTemplate =
    suggestedTemplateId
      ? phase?.session_templates.find((t) => t.id === suggestedTemplateId) ?? null
      : null;
  const pickerOptions = listPickerOptions(plan?.payload ?? null);
  const recentSessions = listSessions({ limit: 14 });
  const inProgress = recentSessions.find((s) => s.state === "in_progress") ?? null;
  const alarms = computePainRecurrenceAlarms();
  const pendingProposals = listProposals("pending").length;

  if (!plan) return <ColdStart />;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Today / Suggestion ─────────────────────────────────────── */}
      <FadeRise>
        <Card glow="activity">
          <CardBody className="p-6 lg:p-8 flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>Training · {fmtRecent(today)}</Eyebrow>
              <Pill tone="neutral" size="sm">{phase?.label ?? plan.payload.current_phase_id}</Pill>
              <Pill tone="neutral" size="sm">Plan v{plan.version}</Pill>
              {insightUsable && (
                <Pill tone="activity" size="sm">
                  Coach · Konfidenz {Math.round((insight?.confidence?.value ?? 0) * 100)}%
                </Pill>
              )}
            </div>
            <h1 className="text-hero">
              {insightUsable && insight?.headline
                ? insight.headline
                : suggestedTemplate
                  ? `Heute vorgeschlagen: ${suggestedTemplate.label}`
                  : scheduleSuggestion.kind === "cardio"
                    ? "Heute vorgeschlagen: Cardio (Z2)"
                    : scheduleSuggestion.kind === "rest"
                      ? "Heute vorgeschlagen: Pause"
                      : scheduleSuggestion.kind === "flex"
                        ? "Kein fester Slot — wähle frei."
                        : "Kein aktiver Plan."}
            </h1>
            {insightUsable && insight?.prescription?.justification_de && (
              <p className="text-body text-muted max-w-[64ch]">
                {insight.prescription.justification_de}
              </p>
            )}
            {!insightUsable && suggestedTemplate && (
              <p className="text-body text-muted max-w-[64ch]">
                {suggestedTemplate.exercises.length} Übung
                {suggestedTemplate.exercises.length === 1 ? "" : "en"} ·{" "}
                {suggestedTemplate.estimated_duration_min ?? "?"} min ·{" "}
                Phase: {phase?.character ?? "—"}
              </p>
            )}
            <div className="mt-2 max-w-md">
              {suggestedTemplate ? (
                <StartSessionButton
                  periodKey={today}
                  sessionTemplateId={suggestedTemplate.id}
                  // When the LLM suggestion differs from the schedule_hint
                  // slot, the user is still picking the *suggested* session
                  // — but the deviation is meaningful and worth recording.
                  deviationReason={
                    insightUsable &&
                    scheduleSuggestion.kind === "session_template" &&
                    scheduleSuggestion.session_template_id !== suggestedTemplate.id
                      ? "recovery"
                      : insightUsable && scheduleSuggestion.kind !== "session_template"
                        ? "recovery"
                        : null
                  }
                  label={`${suggestedTemplate.label} starten`}
                  tone="activity"
                  prominent
                />
              ) : (
                <StartSessionButton
                  periodKey={today}
                  sessionTemplateId={null}
                  deviationReason={scheduleSuggestion.kind === "rest" ? "schedule" : "user_choice"}
                  label="Eigene Session starten"
                  prominent
                />
              )}
            </div>
            {inProgress && (
              <Link
                href={`/training/session/${inProgress.id}`}
                className="inline-flex items-center gap-2 mt-2 text-caption text-muted hover:text-[var(--color-text)] transition-colors"
              >
                <Glyph name="Pause" size={14} />
                Laufende Session vom {fmtTime(inProgress.started_at)} fortsetzen
              </Link>
            )}
          </CardBody>
        </Card>
      </FadeRise>

      {/* ── Alarms (pain recurrence + proposals) ──────────────────── */}
      {(alarms.length > 0 || pendingProposals > 0) && (
        <Section eyebrow="Hinweise" title="Aufmerksamkeit">
          <div className="flex flex-col gap-2">
            {alarms.map((a) => (
              <Card key={a.id} variant="soft">
                <CardBody className="p-3 flex items-center gap-3">
                  <Pill
                    tone={a.severity === "critical" ? "down" : a.severity === "warn" ? "down" : "neutral"}
                    size="sm"
                  >
                    {a.severity}
                  </Pill>
                  <span className="flex-1 text-[0.9375rem]">{a.message_de}</span>
                </CardBody>
              </Card>
            ))}
            {pendingProposals > 0 && (
              <Link href="/training/proposals" className="block">
                <Card hoverable>
                  <CardBody className="p-3 flex items-center gap-3">
                    <Pill tone="activity" size="sm">
                      {pendingProposals} offen
                    </Pill>
                    <span className="flex-1 text-[0.9375rem]">
                      Plan-Vorschläge warten auf Review.
                    </span>
                    <Glyph name="ChevronRight" size={14} className="text-faint" />
                  </CardBody>
                </Card>
              </Link>
            )}
          </div>
        </Section>
      )}

      {/* ── Picker: any defined template ──────────────────────────── */}
      <Section eyebrow="Alle Sessions" title="Frei wählen">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pickerOptions.map((opt) => {
            const isSuggested =
              opt.kind === "session_template" &&
              opt.session_template_id === suggestedTemplateId;
            const deviation = isSuggested ? null : "user_choice";
            return (
              <StartSessionButton
                key={`${opt.kind}-${opt.session_template_id ?? opt.label}`}
                periodKey={today}
                sessionTemplateId={opt.session_template_id}
                deviationReason={deviation}
                label={opt.label}
                tone={opt.kind === "cardio" ? "heart" : "neutral"}
              />
            );
          })}
        </div>
      </Section>

      {/* ── Recent sessions list ──────────────────────────────────── */}
      <Section eyebrow="Verlauf" title="Letzte Sessions">
        <Card variant="soft">
          <CardBody className="p-3">
            {recentSessions.length === 0 ? (
              <div className="p-4 text-caption text-muted">Noch keine Sessions geloggt.</div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {recentSessions.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/training/session/${s.id}`}
                      className="flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-[var(--color-surface-2)]/50 transition-colors"
                    >
                      <span className="num-mono text-caption w-[88px]">
                        {fmtRecent(s.period_key)}
                      </span>
                      <span className="flex-1 truncate text-[0.9375rem]">
                        {s.session_template_id ?? "Eigen"}
                      </span>
                      <Pill
                        tone={
                          s.state === "in_progress"
                            ? "activity"
                            : s.state === "completed"
                              ? "up"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {s.state === "in_progress"
                          ? "läuft"
                          : s.state === "completed"
                            ? "abgeschlossen"
                            : "abgebrochen"}
                      </Pill>
                      <Glyph name="ChevronRight" size={14} className="text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function ColdStart() {
  return (
    <Card>
      <CardBody className="p-8 flex flex-col gap-3">
        <Eyebrow>Training</Eyebrow>
        <h1 className="text-hero">Noch kein Plan importiert.</h1>
        <p className="text-body text-muted max-w-[60ch]">
          Importiere die Seed-Plan-Datei via{" "}
          <code className="font-mono text-caption">tsx runner/src/scripts/import-plan.ts</code>{" "}
          (oder POST <code className="font-mono text-caption">/api/training/plan/import</code>).
        </p>
      </CardBody>
    </Card>
  );
}
