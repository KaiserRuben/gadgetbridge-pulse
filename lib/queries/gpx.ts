import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * GPX (GPS eXchange) resolver + parser.
 *
 * Source-of-truth: Gadgetbridge stores GPX files at
 * `/storage/emulated/0/Android/data/nodomain.freeyourgadget.gadgetbridge/files/<MAC>/workout_<n>_<unixSec>.gpx`
 * on the phone. The `HUAWEI_WORKOUT_SUMMARY_SAMPLE.GPX_FILE_LOCATION`
 * column records that absolute path. Pulse runs on a Mac+Pi pair, neither
 * of which has access to that filesystem unless the user mirrors the
 * Gadgetbridge folder via Syncthing/USB into `$PULSE_ROOT/gpx/`.
 *
 * Lookup order (best-effort):
 *   1. `$PULSE_ROOT/Gadgetbridge/files/<MAC>/<basename>` — runner-extracted zip.
 *   2. `$PULSE_ROOT/Gadgetbridge/files/<basename>`      — flat fallback.
 *   3. `$PULSE_ROOT/gpx/<basename>`                     — legacy single folder.
 *   4. `$PULSE_ROOT/gpx/<MAC>/<basename>`               — legacy MAC layout.
 *   5. `$PULSE_ROOT/<basename>`                         — root folder.
 *
 * Returns null on every miss. The UI then falls back to a helpful hint.
 */

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";

export type GpxPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  ts: number | null; // unix ms, null if no <time> tag
};

export type GpxTrack = {
  source: "phone-mirror" | "syncthing";
  filePath: string;
  points: GpxPoint[];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  distanceM: number;          // Haversine sum
  ascentM: number;            // sum of positive elevation deltas
  descentM: number;           // sum of negative elevation deltas (positive value)
  startTs: number | null;
  endTs: number | null;
};

function basenameFromAndroidPath(p: string): string {
  // Path uses forward slashes (Android); plain split is enough.
  return p.split("/").pop() ?? p;
}

function macFromAndroidPath(p: string): string | null {
  // .../<MAC>/workout_*.gpx — MAC is parent directory.
  const parts = p.split("/");
  if (parts.length < 2) return null;
  const mac = parts[parts.length - 2];
  return /^[0-9A-F:]{17}$/i.test(mac) ? mac : null;
}

async function tryRead(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/** Parse a GPX XML string into a GpxTrack. Returns null if no trkpt found. */
export function parseGpx(xml: string, filePath: string, source: GpxTrack["source"]): GpxTrack | null {
  // Permissive regex parser. GPX is XML but we only need lat/lon + optional
  // ele/time. Avoids pulling in a full DOM parser for what's essentially
  // a flat list. The pattern matches `<trkpt lat="..." lon="..."> ... </trkpt>`
  // and tolerates attribute order + whitespace.
  const trkptRe = /<trkpt\s+([^>]*?)\s*>([\s\S]*?)<\/trkpt>/gi;
  const attrRe = (name: string) => new RegExp(`${name}\\s*=\\s*"([^"]+)"`, "i");
  const eleRe = /<ele>\s*([-\d.]+)\s*<\/ele>/i;
  const timeRe = /<time>\s*([\d:T+\-Z.]+)\s*<\/time>/i;

  const points: GpxPoint[] = [];
  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const latMatch = attrs.match(attrRe("lat"));
    const lonMatch = attrs.match(attrRe("lon"));
    if (!latMatch || !lonMatch) continue;
    const lat = parseFloat(latMatch[1]);
    const lon = parseFloat(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const eleMatch = inner.match(eleRe);
    const timeMatch = inner.match(timeRe);
    points.push({
      lat,
      lon,
      ele: eleMatch ? parseFloat(eleMatch[1]) : null,
      ts: timeMatch ? Date.parse(timeMatch[1]) : null,
    });
  }

  if (points.length < 2) return null;

  // Bounding box.
  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLon = points[0].lon, maxLon = points[0].lon;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // Haversine distance + elevation deltas.
  const R = 6_371_000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const sa = Math.sin(dLat / 2);
    const so = Math.sin(dLon / 2);
    const h = sa * sa + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * so * so;
    distanceM += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    if (a.ele != null && b.ele != null) {
      const d = b.ele - a.ele;
      if (d > 0) ascentM += d;
      else descentM -= d;
    }
  }

  const tsList = points.map((p) => p.ts).filter((t): t is number => t != null);
  return {
    source,
    filePath,
    points,
    bbox: { minLat, maxLat, minLon, maxLon },
    distanceM: Math.round(distanceM),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    startTs: tsList.length > 0 ? Math.min(...tsList) : null,
    endTs: tsList.length > 0 ? Math.max(...tsList) : null,
  };
}

/**
 * Resolve a phone-side GPX path into a local file we can read, then parse.
 * Tries flat + MAC-subfolder + root layouts. Returns null on every miss.
 */
export async function loadGpx(phonePath: string): Promise<GpxTrack | null> {
  const base = basenameFromAndroidPath(phonePath);
  const mac = macFromAndroidPath(phonePath);

  const candidates: string[] = [
    ...(mac ? [path.join(SYNC_ROOT, "Gadgetbridge", "files", mac, base)] : []),
    path.join(SYNC_ROOT, "Gadgetbridge", "files", base),
    path.join(SYNC_ROOT, "gpx", base),
    ...(mac ? [path.join(SYNC_ROOT, "gpx", mac, base)] : []),
    path.join(SYNC_ROOT, base),
  ];

  for (const c of candidates) {
    const xml = await tryRead(c);
    if (!xml) continue;
    const parsed = parseGpx(xml, c, "syncthing");
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Load multiple GPX files and stitch them into a single track. Tracks are
 * concatenated in input order; gaps are not interpolated (the polyline
 * skips over them visually). Returns null if no file resolved.
 */
export async function loadStitchedGpx(phonePaths: string[]): Promise<GpxTrack | null> {
  const tracks: GpxTrack[] = [];
  for (const p of phonePaths) {
    const t = await loadGpx(p);
    if (t) tracks.push(t);
  }
  if (tracks.length === 0) return null;
  if (tracks.length === 1) return tracks[0];

  // Sort by startTs (or filePath fallback) so concatenation is chronological.
  tracks.sort((a, b) => {
    const at = a.startTs ?? 0;
    const bt = b.startTs ?? 0;
    return at - bt;
  });

  const merged: GpxPoint[] = [];
  let bbox = { ...tracks[0].bbox };
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  for (const t of tracks) {
    merged.push(...t.points);
    if (t.bbox.minLat < bbox.minLat) bbox.minLat = t.bbox.minLat;
    if (t.bbox.maxLat > bbox.maxLat) bbox.maxLat = t.bbox.maxLat;
    if (t.bbox.minLon < bbox.minLon) bbox.minLon = t.bbox.minLon;
    if (t.bbox.maxLon > bbox.maxLon) bbox.maxLon = t.bbox.maxLon;
    distanceM += t.distanceM;
    ascentM += t.ascentM;
    descentM += t.descentM;
  }
  const tsList = merged.map((p) => p.ts).filter((t): t is number => t != null);
  return {
    source: "syncthing",
    filePath: tracks.map((t) => t.filePath).join(" + "),
    points: merged,
    bbox,
    distanceM,
    ascentM,
    descentM,
    startTs: tsList.length > 0 ? Math.min(...tsList) : null,
    endTs: tsList.length > 0 ? Math.max(...tsList) : null,
  };
}
