/**
 * Huawei sport-type → German label.
 *
 * The watch firmware emits a one-byte sport code which lands in
 * HUAWEI_WORKOUT_SUMMARY_SAMPLE.TYPE. SQLite stores it as a signed int, so
 * codes 128..255 surface as negative values (e.g. firmware 210 → DB -46,
 * firmware 255 → DB -1). `normalizeSportCode` undoes the signed-byte overflow
 * before lookup so a single mapping covers both representations.
 *
 * Codes were cross-referenced with Gadgetbridge's
 * `HuaweiWorkoutGbParser.huaweiTypeToGbType` and the live values observed in
 * the Pi DB ("Typ -46", "Typ -1", "Typ 7" before this mapping landed).
 */

export const SPORT_NAMES_DE: Record<number, string> = {
  1: "Gehen",
  2: "Laufen",
  3: "Radfahren",
  4: "Laufen",
  5: "Laufband",
  6: "Indoor-Rad",
  7: "Crosstrainer",
  8: "Schwimmen",
  9: "Freiwasser",
  10: "Rudern",
  13: "Wandern",
  14: "Bergsteigen",
  15: "Trailrunning",
  16: "Krafttraining",
  17: "Yoga",
  18: "Sonstige",
  19: "Pilates",
  20: "Tanzen",
  21: "Stepper",
  129: "HIIT",
  130: "Freies Training",
  163: "Skifahren",
  173: "Klettern",
  175: "Tischtennis",
  176: "Tennis",
  177: "Badminton",
  178: "Basketball",
  179: "Fußball",
  192: "E-Sport",
  210: "Freies Training",
  255: "Aktivität",
};

function normalizeSportCode(kind: number): number {
  if (!Number.isFinite(kind)) return kind;
  if (kind < 0 && kind >= -128) return kind + 256;
  return kind;
}

export function sportName(kind: number): string {
  const code = normalizeSportCode(kind);
  return SPORT_NAMES_DE[code] ?? `Aktivität ${code}`;
}
