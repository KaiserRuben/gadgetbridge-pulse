"use server";

import { revalidatePath } from "next/cache";
import { writeFeel } from "@/lib/feel";
import type { LogActionState } from "@/components/log/action-state";

export async function submitFeel(prev: LogActionState, fd: FormData): Promise<LogActionState> {
  const raw = fd.get("feel");
  const feel = raw != null && typeof raw === "string" ? Number(raw) : NaN;
  const note = readString(fd, "note");

  if (!Number.isInteger(feel) || feel < 1 || feel > 5) {
    return { status: "error", message: "Skala 1–5 wählen.", ok_seq: prev.ok_seq };
  }

  try {
    writeFeel({ ts_iso: new Date().toISOString(), feel, note, source: "user_input" });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Schreiben fehlgeschlagen.", ok_seq: prev.ok_seq };
  }

  revalidatePath("/log");
  revalidatePath("/log/feel");

  return { status: "ok", message: "Stimmung gespeichert.", ok_seq: prev.ok_seq + 1 };
}

function readString(fd: FormData, k: string): string | null {
  const raw = fd.get(k);
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}
