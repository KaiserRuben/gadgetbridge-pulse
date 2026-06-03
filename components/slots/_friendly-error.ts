/**
 * Sanitize raw slot error messages for UI. AJV-style paths and `fetch failed`
 * leak into the dashboard as engineering noise; this maps the common shapes to
 * user-friendly German lines and preserves the original in `raw` for a
 * `<details>` block.
 */
export interface FriendlySlotError {
  summary: string;
  raw: string;
}

export function friendlySlotError(
  message: string | null | undefined,
): FriendlySlotError {
  const raw = (message ?? "").trim();
  if (raw.length === 0) {
    return {
      summary: "Berechnung fehlgeschlagen — bitte erneut versuchen.",
      raw: "unbekannt",
    };
  }
  if (raw.includes("fetch failed")) {
    return { summary: "Verbindung zum Modell unterbrochen.", raw };
  }
  if (raw.startsWith("/")) {
    return { summary: "Modell-Ausgabe ungültig.", raw };
  }
  return {
    summary: "Berechnung fehlgeschlagen — bitte erneut versuchen.",
    raw,
  };
}
