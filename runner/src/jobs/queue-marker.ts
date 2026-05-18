/**
 * Syncthing-backed CTA queue bridge.
 *
 * Topology:
 *   - User clicks a CTA on the Pi dashboard.
 *   - Pi enqueue route writes a tiny marker file into
 *     `$INSIGHTS_ROOT/queue/<cluster>__<key>__<scope>.json`.
 *   - Syncthing replicates the file to the Mac (~1–5s).
 *   - Mac's event dispatcher tick scans the queue dir, pushes each marker
 *     onto its local worker queue, and deletes the marker.
 *
 * Why a file bridge (not Redis / HTTP):
 *   - `pulse.db` is single-writer Pi (Syncthing on SQLite = silent
 *     corruption), so the Mac cannot observe Pi-side `PULSE_INSIGHT` writes
 *     directly.
 *   - `$INSIGHTS_ROOT/**` is already Syncthing-replicated.
 *   - Mac has no inbound HTTP exposed; Redis would need new infra.
 *
 * Marker filename: `<cluster>__<key>__<scope>.json`. Double-underscore is
 * the separator so cluster names with single underscores (`weekly_recap`)
 * don't collide. Filenames are sanitised on write — anything that isn't
 * `[A-Za-z0-9_-]` is rejected to keep `..` and `/` out of the path.
 *
 * Marker body is intentionally tiny (4 fields). It's a *signal*, not a
 * payload — Mac re-derives priority + reason from it and pushes into its
 * own QueueItem.
 *
 * Idempotency: scanMarkers + consume happen on a single dispatcher tick.
 * If two ticks see the same marker (Syncthing retransmit, concurrent
 * dispatchers), the cluster simply re-runs — release() is idempotent and
 * the JobCell tracks status.
 */

import { mkdir, readdir, readFile, unlink, writeFile, rename } from "node:fs/promises";
import path from "node:path";

const QUEUE_DIR_NAME = "queue";

export interface QueueMarker {
  cluster: string;
  key: string;
  scope: "daily" | "weekly";
  priority: number;
  reason: string;
  requested_at: string;
}

function getInsightsRoot(): string {
  // Same resolution order as runner config and Pi page handlers — the env
  // var wins, otherwise default under PULSE_ROOT (~/pulse). We don't
  // import config.ts because this module is loaded from both Pi (Next.js
  // bundle) and Mac (runner CLI) and we want to avoid the cascade.
  const insightsRoot = process.env.INSIGHTS_ROOT;
  if (insightsRoot && insightsRoot.length > 0) return insightsRoot;
  const pulseRoot = process.env.PULSE_ROOT;
  if (pulseRoot && pulseRoot.length > 0) return path.join(pulseRoot, "insights");
  return path.join(process.env.HOME ?? ".", "pulse", "insights");
}

export function queueDir(): string {
  return path.join(getInsightsRoot(), QUEUE_DIR_NAME);
}

const SAFE_FILENAME = /^[A-Za-z0-9_-]+$/;

function safeFilename(cluster: string, key: string, scope: string): string {
  for (const part of [cluster, key, scope]) {
    if (!SAFE_FILENAME.test(part)) {
      throw new Error(`queue-marker: unsafe path component "${part}"`);
    }
  }
  return `${cluster}__${key}__${scope}.json`;
}

function parseFilename(filename: string): { cluster: string; key: string; scope: string } | null {
  if (!filename.endsWith(".json")) return null;
  const base = filename.slice(0, -".json".length);
  const parts = base.split("__");
  if (parts.length !== 3) return null;
  const [cluster, key, scope] = parts;
  if (scope !== "daily" && scope !== "weekly") return null;
  return { cluster, key, scope };
}

/**
 * Atomic marker write — tmp + rename so Syncthing never picks a partial
 * file. Always writes (no skip-if-exists) so a second click updates the
 * timestamp/priority.
 */
export async function writeMarker(input: {
  cluster: string;
  key: string;
  scope: "daily" | "weekly";
  priority: number;
  reason: string;
}): Promise<void> {
  const filename = safeFilename(input.cluster, input.key, input.scope);
  const dir = queueDir();
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  const body: QueueMarker = {
    cluster: input.cluster,
    key: input.key,
    scope: input.scope,
    priority: input.priority,
    reason: input.reason,
    requested_at: new Date().toISOString(),
  };
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(body), "utf8");
  await rename(tmp, filePath);
}

export interface ScannedMarker extends QueueMarker {
  filename: string;
}

/**
 * Read every marker currently in the queue dir. Returns an empty array
 * when the dir is missing (first run / nothing enqueued yet).
 *
 * Filenames that don't parse or whose body is malformed are skipped + the
 * file deleted so the queue dir doesn't grow with junk.
 */
export async function scanMarkers(): Promise<ScannedMarker[]> {
  const dir = queueDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const out: ScannedMarker[] = [];
  for (const filename of entries) {
    if (!filename.endsWith(".json")) continue;
    if (filename.includes(".tmp.")) continue; // mid-write, skip
    const parsedName = parseFilename(filename);
    if (!parsedName) {
      // Junk filename — sweep so it doesn't pile up.
      await unlink(path.join(dir, filename)).catch(() => {});
      continue;
    }
    try {
      const txt = await readFile(path.join(dir, filename), "utf8");
      const body = JSON.parse(txt) as QueueMarker;
      if (
        body.cluster !== parsedName.cluster ||
        body.key !== parsedName.key ||
        body.scope !== parsedName.scope
      ) {
        // Body disagrees with filename — trust the body, but still log
        // (caller surfaces via dispatcher).
      }
      out.push({ ...body, filename });
    } catch {
      await unlink(path.join(dir, filename)).catch(() => {});
    }
  }
  return out;
}

/**
 * Delete a marker after the dispatcher has accepted it. Best-effort; if
 * Syncthing re-creates the file we'll just re-enqueue on the next tick
 * (cluster work is idempotent).
 */
export async function consumeMarker(filename: string): Promise<void> {
  const filePath = path.join(queueDir(), filename);
  await unlink(filePath).catch(() => {});
}
