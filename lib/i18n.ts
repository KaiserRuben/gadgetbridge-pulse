/**
 * UI label dictionary for runner-emitted enums + technical English tokens.
 * Single source of truth for German strings; lets components stay declarative.
 */

export function tDomain(d: string): string {
  return d === "sleep" ? "Schlaf"
       : d === "heart" || d === "cardio" ? "Herz"
       : d === "activity" ? "Bewegung"
       : d === "stress" ? "Stress"
       : d === "body" ? "Körper"
       : d;
}

export function tConfidence(c: string): string {
  return c === "high" ? "hohe Konfidenz"
       : c === "medium" ? "mittlere Konfidenz"
       : c === "low" ? "geringe Konfidenz"
       : c;
}

export function tConfidenceShort(c: string): string {
  return c === "high" ? "hoch"
       : c === "medium" ? "mittel"
       : c === "low" ? "gering"
       : c;
}

export function tSeverity(s: string): string {
  return s === "soft" ? "Hinweis"
       : s === "hard" ? "kritisch"
       : s;
}

export function tGate(g: string): string {
  return g === "z_score" ? "z-Wert"
       : g === "absolute" ? "Absolutwert"
       : g === "duration" ? "Dauer"
       : g === "pattern" ? "Muster"
       : g === "compound" ? "Kombination"
       : g;
}

export function tStressBucket(label: string): string {
  return label === "Relaxed" ? "Entspannt"
       : label === "Mild" ? "Leicht"
       : label === "Moderate" ? "Moderat"
       : label === "High" ? "Hoch"
       : label;
}

export function tHrZone(label: string): string {
  return label === "Rest" ? "Ruhe"
       : label === "Easy" ? "Leicht"
       : label === "Aerobic" ? "Aerob"
       : label === "Threshold" ? "Schwelle"
       : label === "Max" ? "Max"
       : label;
}
