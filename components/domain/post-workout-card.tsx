import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import type { WorkoutFull, ActivityInsightV3 } from "@/lib/types/v3";

const ACTIVITY_KIND_LABEL: Record<number, string> = {
  // Map known HUAWEI activity kind codes to human labels.
  // 67109090 is the value seen in Workouts 11/12/13 — running.
  67109090: "Lauf",
};

/**
 * Surfaces a freshly-completed workout. Tied to mode=post-workout.
 * Data: latest workout from activity_package + recovery_demand KPI from
 * activity_insight + the activity-domain top suggestion.
 */
export function PostWorkoutCard({
  workout,
  activityInsight,
  date,
}: {
  workout: WorkoutFull;
  activityInsight: ActivityInsightV3 | null;
  date: string;
}) {
  const kind = ACTIVITY_KIND_LABEL[workout.kind] ?? workout.name ?? "Workout";
  const startTime = formatTime(workout.ts_start_iso);
  const tone = bandTone(activityInsight);

  // Pull recovery_demand KPI (3rd in activity insight) for the headline number.
  const recoveryDemand = activityInsight?.kpis.find((k) => k.id === "recovery_demand");
  const trainingQuality = activityInsight?.kpis.find((k) => k.id === "training_quality");
  // Pick first activity suggestion if any.
  const suggestion = activityInsight?.suggestions_today[0] ?? null;

  return (
    <Link href={`/activity/${date}`} className="block group">
      <Card glow="activity" className="transition-shadow group-hover:shadow-lg">
        <CardBody className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Eyebrow>Nach Training · neu</Eyebrow>
            <Pill tone="up" size="sm" className="animate-pulse">
              ●
            </Pill>
          </div>

          <div className="flex flex-col gap-1">
            <h2 className="text-h2 font-semibold">
              {kind} {startTime}
            </h2>
            <p className="text-body-sm text-muted">
              {workout.duration_min} min · {fmtDistance(workout.distance_m)} ·{" "}
              {fmtCalories(workout.active_calories)} kcal
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {trainingQuality && (
              <KpiBlock
                label="Trainings-Quality"
                value={trainingQuality.value}
                tone={tone}
              />
            )}
            {recoveryDemand && (
              <KpiBlock
                label="Erholungs-Bedarf"
                value={recoveryDemand.value}
                tone={tone}
              />
            )}
          </div>

          {workout.recovery_time_h != null && (
            <p className="text-body-sm">
              <span className="text-caption text-muted uppercase tracking-wide block mb-1">
                Nächstes Training
              </span>
              ab {formatRecoveryTime(workout.ts_end_iso, workout.recovery_time_h)}
            </p>
          )}

          {suggestion && (
            <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-body-sm">
              <p className="text-caption text-muted">⚓ {suggestion.anchor}</p>
              <p className="font-medium mt-1">{suggestion.tiny}</p>
              <p className="text-body-sm text-muted mt-0.5">{suggestion.why}</p>
            </div>
          )}

          <span className="text-caption text-muted opacity-60 group-hover:opacity-100 transition-opacity">
            Vollständige Workout-Analyse →
          </span>
        </CardBody>
      </Card>
    </Link>
  );
}

function KpiBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "up" | "down" | "steady" | "low";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="num text-[1.75rem] font-semibold tabular-nums">{value}</span>
        <Pill tone={tone} size="sm">
          /100
        </Pill>
      </div>
    </div>
  );
}

function fmtDistance(m: number | null): string {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m} m`;
}

function fmtCalories(c: number | null): string {
  if (c == null) return "—";
  return Math.round(c).toString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function formatRecoveryTime(endIso: string, hours: number): string {
  const end = new Date(endIso);
  const next = new Date(end.getTime() + hours * 3600 * 1000);
  return next.toLocaleString("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function bandTone(insight: ActivityInsightV3 | null): "up" | "down" | "steady" | "low" {
  if (!insight || insight.kpis.length === 0) return "low";
  const avg = insight.kpis.reduce((s, k) => s + k.value, 0) / insight.kpis.length;
  return avg >= 65 ? "up" : avg <= 35 ? "down" : "steady";
}
