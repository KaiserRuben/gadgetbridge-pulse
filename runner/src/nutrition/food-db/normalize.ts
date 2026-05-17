/**
 * food_key normalisation + fuzzy match.
 *
 * Locked strategy per docs/NUTRITION_VLM_VALIDATION.md §5:
 *   - snake_case, German base
 *   - Umlaute transliterated: ä → ae, ö → oe, ü → ue, ß → ss
 *   - Strip trailing plural `_n` / `_en`
 *   - Damerau-Levenshtein fuzzy match against existing keys before treating
 *     a new key as truly new
 *
 * Labels (display strings) are NOT touched here — keep Umlauten in `label`.
 */

const UMLAUT_MAP: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
};

/** Canonicalise a food_key to the locked form. */
export function normalizeFoodKey(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c);
  s = s.replace(/[^a-z0-9_]+/g, "_");
  s = s.replace(/_+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  s = stripPluralSuffix(s);
  return s;
}

/**
 * Strip a single trailing German plural ending when it leaves a non-trivial
 * stem. Conservative — only `_en` and `_n`, never on words shorter than 4
 * chars after the strip.
 */
function stripPluralSuffix(s: string): string {
  if (s.endsWith("_en") && s.length - 3 >= 4) {
    return s.slice(0, -3);
  }
  if (s.endsWith("_n") && s.length - 2 >= 4) {
    return s.slice(0, -2);
  }
  if (s.endsWith("en") && !s.includes("_") && s.length - 2 >= 4) {
    return s.slice(0, -2);
  }
  return s;
}

/**
 * Damerau-Levenshtein distance. O(n*m) DP, fine for ≤200-char strings and
 * a few hundred known keys per call.
 */
function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  const d: number[][] = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i++) d[i][0] = i;
  for (let j = 0; j <= bLen; j++) d[0][j] = j;
  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[aLen][bLen];
}

interface FuzzyMatch {
  key: string;
  distance: number;
}

/**
 * Find the closest existing key to `candidate` within `maxDistance`. Returns
 * null if no key is close enough. Use this BEFORE invoking the LLM
 * fallback: if a near-miss exists in the seed/cache, prefer that and skip
 * a 130-second enrichment call.
 *
 * `maxDistance` defaults to 2 — catches `radischen → radieschen` (1 op),
 * `lachs_raeuchert → lachs_geraeuchert` (1 op), `kichererbsen_gekocht →
 * kichererbse_gekocht` (1 op) without bridging genuinely different foods.
 */
export function fuzzyMatchKey(
  candidate: string,
  knownKeys: Iterable<string>,
  maxDistance = 2,
): FuzzyMatch | null {
  const normalised = normalizeFoodKey(candidate);
  let best: FuzzyMatch | null = null;
  for (const key of knownKeys) {
    if (key === normalised) return { key, distance: 0 };
    const d = damerauLevenshtein(normalised, key);
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { key, distance: d };
    }
  }
  return best;
}
