"use server";

import { revalidatePath } from "next/cache";
import { writeManualLog } from "@/lib/manual-log";
import type { LogActionState } from "@/components/log/action-state";

const WEIGHT_MIN = 30;
const WEIGHT_MAX = 300;
const BF_MIN = 1;
const BF_MAX = 60;

export async function submitWeight(prev: LogActionState, fd: FormData): Promise<LogActionState> {
  const weight = readNumber(fd, "weight_kg");
  const bf = readNumber(fd, "body_fat_pct");
  const note = readString(fd, "note");

  if (weight === null) return err(prev, "Gewicht erforderlich.");
  if (weight < WEIGHT_MIN || weight > WEIGHT_MAX) return err(prev, `Gewicht muss zwischen ${WEIGHT_MIN}–${WEIGHT_MAX} kg liegen.`);
  if (bf !== null && (bf < BF_MIN || bf > BF_MAX)) return err(prev, `Körperfett muss zwischen ${BF_MIN}–${BF_MAX} % liegen.`);

  const ts = new Date().toISOString();
  try {
    writeManualLog({ ts_iso: ts, metric: "weight_kg", value: round1(weight), unit: "kg", source: "user_input", note });
    if (bf !== null) {
      writeManualLog({ ts_iso: ts, metric: "body_fat_pct", value: round1(bf), unit: "%", source: "user_input", note });
    }
  } catch (e) {
    return err(prev, e instanceof Error ? e.message : "Schreiben fehlgeschlagen.");
  }

  revalidatePath("/log");
  revalidatePath("/log/weight");
  revalidatePath("/", "layout");

  return {
    status: "ok",
    message: bf !== null ? `${round1(weight)} kg + ${round1(bf)} % gespeichert.` : `${round1(weight)} kg gespeichert.`,
    ok_seq: prev.ok_seq + 1,
  };
}

function readNumber(fd: FormData, k: string): number | null {
  const raw = fd.get(k);
  if (raw == null || typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function readString(fd: FormData, k: string): string | null {
  const raw = fd.get(k);
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function err(prev: LogActionState, message: string): LogActionState {
  return { status: "error", message, ok_seq: prev.ok_seq };
}
