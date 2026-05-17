/**
 * Watches Gadgetbridge.zip in $PULSE_ROOT and extracts it to:
 *   - $PULSE_ROOT/Gadgetbridge.db   (atomic rename of database/Gadgetbridge)
 *   - $PULSE_ROOT/Gadgetbridge/...  (full export tree, incl. files/<MAC>/*.gpx)
 *
 * Triggers downstream daily-watch via the DB mtime change.
 */

import chokidar from "chokidar";
import { spawn } from "node:child_process";
import { mkdir, rename, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { log } from "./logger.ts";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "/data";
const ZIP_PATH = process.env.GADGETBRIDGE_ZIP_PATH ?? path.join(SYNC_ROOT, "Gadgetbridge.zip");
const EXTRACT_ROOT = path.join(SYNC_ROOT, "Gadgetbridge");
const DB_TARGET = process.env.GADGETBRIDGE_DB_PATH ?? path.join(SYNC_ROOT, "Gadgetbridge.db");

let lastZipMtimeMs = 0;

function unzipTo(zip: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -o overwrite without prompt, -q quiet
    const proc = spawn("unzip", ["-o", "-q", zip, "-d", dest], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`))));
  });
}

/**
 * Extract `$PULSE_ROOT/Gadgetbridge.zip` into:
 *   - `$PULSE_ROOT/Gadgetbridge/...`   (in-place overwrite — Syncthing-safe)
 *   - `$PULSE_ROOT/Gadgetbridge.db`    (atomic rename via staging file)
 *
 * Returns true if extraction ran, false if the zip is missing or unchanged
 * since the last call. Skipping unchanged zips avoids fighting Syncthing
 * over file mtimes; the DB-target mtime drives downstream watchers.
 */
export async function extractOnce(opts?: { force?: boolean }): Promise<boolean> {
  if (!existsSync(ZIP_PATH)) return false;
  const st = await stat(ZIP_PATH);
  if (!opts?.force && st.mtimeMs <= lastZipMtimeMs) return false;

  await mkdir(EXTRACT_ROOT, { recursive: true });
  // In-place overwrite — `unzip -o` skips identical files and replaces newer
  // ones. We never delete EXTRACT_ROOT first because Syncthing keeps live
  // `.syncthing.*.tmp` files inside subfolders, which would race against
  // `rm -rf` (ENOTEMPTY).
  await unzipTo(ZIP_PATH, EXTRACT_ROOT);

  // Promote the DB out of the extract tree via an atomic rename so readers
  // (web app on Pi) never see a half-written file.
  const extractedDb = path.join(EXTRACT_ROOT, "database", "Gadgetbridge");
  if (existsSync(extractedDb)) {
    const dbStaging = `${DB_TARGET}.staging.${process.pid}`;
    await copyFile(extractedDb, dbStaging);
    await rename(dbStaging, DB_TARGET);
  }

  lastZipMtimeMs = st.mtimeMs;
  log.info("zip", `extracted ${ZIP_PATH} → ${EXTRACT_ROOT}`);
  return true;
}

export function watchZip(): void {
  let pending: NodeJS.Timeout | null = null;
  let running = false;
  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      pending = null;
      if (running) return;
      running = true;
      try {
        await extractOnce();
      } catch (err) {
        log.error("zip", `failed: ${(err as Error).message}`);
      } finally {
        running = false;
      }
    }, 2500);
  };
  // Polling is required: Docker Desktop bind-mounts on macOS don't propagate
  // host fsevents into the container, so inotify never fires for Syncthing
  // writes. Zip arrives roughly once a day — 10 min poll is plenty fast.
  chokidar
    .watch(ZIP_PATH, {
      awaitWriteFinish: { stabilityThreshold: 3000 },
      usePolling: true,
      interval: 600_000,
      binaryInterval: 600_000,
    })
    .on("change", trigger)
    .on("add", trigger);
}
