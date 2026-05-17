"use server";

import { revalidatePath } from "next/cache";
import { writeJournal } from "@/lib/journal";
import type { LogActionState } from "@/components/log/action-state";

export async function submitJournal(prev: LogActionState, fd: FormData): Promise<LogActionState> {
  const text = readString(fd, "text");
  const moodRaw = fd.get("mood");
  const mood = moodRaw != null && typeof moodRaw === "string" && moodRaw.trim() !== "" ? Number(moodRaw) : null;
  const tagsRaw = readString(fd, "tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  if (!text && tags.length === 0 && mood == null) {
    return { status: "error", message: "Mindestens ein Feld füllen.", ok_seq: prev.ok_seq };
  }
  if (mood != null && (!Number.isInteger(mood) || mood < 1 || mood > 5)) {
    return { status: "error", message: "Stimmung 1–5.", ok_seq: prev.ok_seq };
  }

  try {
    writeJournal({
      ts_iso: new Date().toISOString(),
      text,
      mood,
      tags,
      source: "user_input",
    });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Schreiben fehlgeschlagen.", ok_seq: prev.ok_seq };
  }

  revalidatePath("/log");
  revalidatePath("/log/journal");

  return { status: "ok", message: "Eintrag gespeichert.", ok_seq: prev.ok_seq + 1 };
}

function readString(fd: FormData, k: string): string | null {
  const raw = fd.get(k);
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}
