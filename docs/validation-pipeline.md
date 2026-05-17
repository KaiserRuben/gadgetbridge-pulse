# Pulse deployment pipeline — validation report

Audit date: 2026-05-08. Scope: the 10-step Mac→Pi flow (watch → Gadgetbridge → Syncthing → Mac runner → insights/pulse.db → Syncthing → Pi dashboard).

---

## 1. TL;DR

**Mac side ships today.** The runner container is up (`docker ps` shows
`gadgetbridge-runner` running 3 h, latest log line is a clean
`pipeline=abstained verify=ok`), launchd is loaded
(`launchctl list | grep gadget` → 45636), and `daily/2026-05-08/` exists
in `insights/`. The recent `assertDbExists()` build fix is correct and
sufficient to unblock `next build` on the Pi.

**Pi side will boot but is incomplete.** Three blockers:

1. `pulse.service` does NOT export `PULSE_DB_PATH` (`deploy/pulse.service:13-16`).
   On Pi, `resolvePulseDbPath()` falls through to the hard-coded Mac path
   (`lib/db-paths.ts:83`), so any write attempt creates pulse.db at a path
   that does not exist on the Pi filesystem.
2. The two on-demand Ollama routes (`/api/explain-anomaly`,
   `/api/ingest-screenshot`) default `OLLAMA_URL` to `localhost:11434`
   (`app/api/explain-anomaly/route.ts:21`,
   `app/api/ingest-screenshot/route.ts:25`); the Pi has no Ollama. Calls
   will return HTTP 500/502 with `connect ECONNREFUSED` text in the JSON
   body — not a graceful fallback.
3. `runner/src/db-migrate.ts:15` opens `config.dbPath` (= **Gadgetbridge.db**)
   in read-write mode. This is the source-of-truth file Syncthing replaces
   wholesale; running this CLI even once will (a) silently install
   `PULSE_*` tables in the wrong DB and (b) get them wiped on the next phone
   export. The runtime path uses `getWritableDb()` which is correct, so this
   only bites a manual operator — but it's a footgun.

Everything else (concurrent-write race, Pi memory, Recharts SSR, sync
cadence) is acceptable risk with documented mitigations below.

---

## 2. Per-stage status

### A. Mac runner

- `runner/docker-compose.yml:14` sets `OLLAMA_URL=http://host.docker.internal:11434`,
  with the matching `host-gateway` `extra_hosts` entry on line 21. Reachability
  confirmed in deploy README (`deploy/README.md:42`). Volume mount
  `"~/pulse:/data"` (line 18) exposes both
  `Gadgetbridge.db` and `pulse.db` inside the container.
- `runner/Dockerfile` installs build toolchain for native sqlite (`python3 make
  g++ sqlite-dev`) but **does not install sharp** — fine, because sharp is only
  used by the Next.js side (`lib/image-resize.ts:33`). The runner package.json
  (`runner/package.json:15-21`) only depends on `better-sqlite3`, `chokidar`,
  `undici`, `ajv`. Verified.
- `runner/src/db.ts:14` opens Gadgetbridge.db with `readonly: true,
  fileMustExist: true` and `query_only = ON`. `runner/src/db-writable.ts:23`
  opens **pulse.db** writable. The two paths are kept distinct in
  `runner/src/config.ts:26,34`. ✅ runner stays read-only on GB.db.
- `deploy/pulse-runner.plist:11` watches the right path.
  `StartCalendarInterval` (Sunday 06:00) is reasonable as a backstop; primary
  trigger is `WatchPaths` mtime change.

### B. Pi dashboard

- `runner/src/config.ts:91-96` lazy `assertDbExists()` is called at
  `runner/src/index.ts:211` (`main()`). No other module-init `existsSync` /
  `statSync` / `new Database()` calls fire on import:
  - `lib/db.ts` — all fs/db calls inside `db()` / `dbStat()` (lines 48,79).
  - `lib/pulse-db.ts:42` — fs/db inside `pulseDb()`. No top-level.
  - `lib/db-writable.ts:34` — `new Database()` inside `getWritableDb()`. No top-level.
  - `lib/db-paths.ts:50` — `existsSync` inside `resolveDbPath()`. No top-level.
  - `runner/src/db.ts:9-19` — fs/db inside `db()`. No top-level.
  - `runner/src/pulse-db.ts:19-31` — fs/db inside `pulseDb()`. No top-level.
  - `runner/src/db-writable.ts:20-33` — fs/db inside `getWritableDb()`.
  - **All other** runner `Database()` calls live inside functions or CLI
    `main()` blocks (`runner/src/db-migrate.ts:15` is in `main()`,
    `runner/src/db-migrations.ts:148` is inside `runMigrations()`).
  - `app/api/health/route.ts:8` calls `db()` inside the GET handler — runtime,
    not import time.
  - The build fix is correct. No remaining top-level throws.
- Cold start on Pi when pulse.db is missing: readers (`pulseDb()`) return
  `null` and accessors short-circuit to `[]` (`lib/queries/patterns.ts:34-58`,
  `lib/manual-log.ts:38-39`, `lib/journal.ts:44-45`, `lib/feel.ts:27-28`,
  `lib/user-attributes.ts:67-95`). Graceful. ✅
- Cold start on Pi when **Gadgetbridge.db** is missing: `lib/db.ts:39-43`
  throws — fatal for any RSC that hits `db()`. Acceptable: GB.db must be
  Syncthing-synced before the dashboard is useful. The `/api/health` endpoint
  surfaces this clearly.
- tsconfig path alias: `tsconfig.json:18-21` defines `@/runner/* →
  ./runner/src/*`. `tsconfig.json:34` excludes `runner` from the **dashboard's**
  TS compilation, but `tsconfig.json:29-32` re-includes the four analyzer
  files imported by routes. The standalone build does include the compiled
  routes (`.next/standalone/.next/server/app/api/explain-anomaly/route.js`
  exists; nft.json present), so the imports survive `next build`. ✅

### C. Cross-host LLM gap

The Pi has no Ollama. Routes that call it:

| route                                    | env default                  | Pi behaviour                                  |
|------------------------------------------|------------------------------|-----------------------------------------------|
| `/api/explain-anomaly`                   | `localhost:11434`            | `fetch` returns ECONNREFUSED → HTTP 500 JSON  |
| `/api/ingest-screenshot`                 | `localhost:11434`            | Same → HTTP 502 JSON                          |
| `/api/ingest-screenshot/commit`          | (no Ollama call — pure DB)   | Works **iff** pulse.db writable (see B/D)     |

The Why? button (`components/ui/why-button.tsx:139-167`) and screenshot
ingest form (`components/log/screenshot-ingest-form.tsx:191-233`) already
surface the JSON `error` field, so the user sees a German error message
rather than a hard crash. Not great UX, not catastrophic.

Recommended option: set `OLLAMA_URL=http://<mac-host>.local:11434` (or the
Tailscale IP) in `pulse.service` Environment block. Mac's Ollama would
need to bind to all interfaces (`OLLAMA_HOST=0.0.0.0:11434`) — by default
it's localhost-only. Latency over LAN is fine (single round-trip per
click, model is already warm on the Mac). See §5.

### D. Concurrent write safety

Both ends write to `pulse.db`:

- Mac runner: `upsertPattern` (`runner/src/analyzer/pattern-library.ts:74`)
  every daily-watch run.
- Pi (or Mac browser): `writeManualLog`, `writeJournal`, `writeFeel`,
  `writeUserAttributes` from server actions and the screenshot commit
  route.

WAL mode + `busy_timeout = 5000` ms is set in both writable handles
(`lib/db-writable.ts:36-37`, `runner/src/db-writable.ts:25-26`). Within
**one machine** this is safe. Across machines via Syncthing: SQLite has no
file-locking awareness across hosts — Syncthing eventually-consistent
replication of a binary SQLite file with `-wal` and `-shm` sidecars **will
corrupt or revert writes**. Symptoms already visible: the live folder shows
`pulse.db-shm` and `pulse.db-wal` (33k+91k) being modified at 21:51-21:52 on
both machines simultaneously.

Worst case: Mac writes pattern row at T0; Pi writes journal entry at T0+10s
before Mac's WAL checkpoint flushes. Syncthing replicates Mac's `pulse.db`
overwriting Pi's. Pi's journal write is lost.

**Mitigations (pick one):**

- Single-writer policy. Pi writes go to a **separate** Pi-owned `pulse-pi.db`;
  the dashboard merges read-side. Migration cost = repointing `getWritableDb`
  per host.
- Write-back endpoint. Pi UI POSTs to a Mac-only endpoint (Tailscale)
  that owns all `pulse.db` writes. Pi DB is read-only.
- Document Pi as **read-only** (matches `pulse.service` description line 2),
  disable Pi-side write UI in production. Dashboard already calls Mac browser
  the "full mode" host — make this real.

Recommend option 3 short-term + option 2 once Tailscale is wired.

### E. Pi resource constraints

`deploy/pulse.service:21-22`: `MemoryMax=512M`, `CPUQuota=80%`.

- `du -sh .next` = 378M total; `.next/standalone` = 51M (1.5 M of
  trace+manifest, 49 M of node_modules — the only required prod tree).
  Standalone server is what `pulse.service:17` runs. Pi RAM footprint
  ≈ standalone bundle (cold) + per-request RSS spike. Recharts SSR on a
  week page is ~120-180 MB observed in similar Next.js setups; with
  `next start -p 3030` and one or two concurrent users, 512 M is tight but
  workable. Add a `node --max-old-space-size=384` override if OOMs appear.
  Recommend monitoring with `journalctl -u pulse | grep -i 'oom\|killed'`.
- The standalone build copies `runner/package.json` only; the analyzer .ts
  files are inlined into `route.js`, so no extra Pi dependency is needed.

### F. Sync cadence

Current Gadgetbridge auto-export schedule (Android side): 12 h starting
08:00 → effectively 08:00 + 20:00 daily. With daily-watch on the Mac
firing on every db mtime change, this means insights refresh twice a day.

Tradeoff: Huawei Health → Gadgetbridge sync is the battery-expensive step
on Android (BLE pull); the Mac runner is free.

Recommend: **2x daily (08:00 + 20:00)** stays. Rationale below in §4.

### G. Smoke chain

Cannot run a full smoke without Pi handy, but Mac side validated:

- `Gadgetbridge.db` mtime is 2026-05-08 18:36; latest insight is
  `daily/2026-05-08/` ✅
- launchd plist loaded ✅
- Container running 3 h, latest log shows a clean `pipeline=abstained
  verify=ok` ✅
- mtime hot-reload: `lib/db.ts:50-67` re-stats and reopens on mtime/inode
  change ✅. `lib/pulse-db.ts:44-67` mirrors this for pulse.db ✅.
  `dbStat` in `/api/health` exposes mtime to the operator.
- `touch -m Gadgetbridge.db` would re-fire launchd's WatchPaths and start a
  new compose run — but the runner container is already up
  (`restart: "no"`), so a `docker compose up` is idempotent. The container's
  `daily-watch` mode re-fires on chokidar's `change` event
  (`runner/src/index.ts:204-207`).

---

## 3. Top 5 critical issues

1. **Pi `pulse.service` missing `PULSE_DB_PATH`** (`deploy/pulse.service:13-16`).
   Add `Environment=PULSE_DB_PATH=$PULSE_ROOT/pulse.db`. Without
   it any write path on the Pi will try to create the file at the hardcoded
   Mac path and fail with ENOENT.
2. **Bidirectional Syncthing on `pulse.db` will corrupt SQLite.** Syncthing
   replicates the binary file + WAL/SHM sidecars; conflicting writes from Mac
   and Pi get overwritten silently. Either declare Pi read-only or split the
   DB per host. (See §2.D.)
3. **`runner/src/db-migrate.ts:15` opens Gadgetbridge.db in read-write mode.**
   Should be `config.pulseDbPath`, mirroring `migrate-to-pulse-db.ts:194-195`
   pattern. Wrong DB → migrations land in the file Syncthing wipes on every
   phone export.
4. **On-demand LLM routes have no graceful Pi fallback.** Either route Pi's
   `OLLAMA_URL` to the Mac (Tailscale or LAN), or detect Ollama-absent at
   request time and return HTTP 503 with a translated user-facing message
   ("Diese Funktion ist nur im Mac-Browser verfügbar.").
5. **Standalone build size (49 M node_modules) on a 512 M Pi is comfortable
   but Recharts SSR can spike.** Watch for OOM kills. Mitigation: add
   `Environment="NODE_OPTIONS=--max-old-space-size=384"` to `pulse.service`.

---

## 4. Recommended sync schedule

**Keep 2x daily at 08:00 and 20:00.** Rationale:

- 08:00 ingest captures the full prior-night sleep + early-morning HRV
  reading from the watch. Insights ready by ~08:05 (runner stages take
  ~3 min wall time per the latest log: `stage4_prose:157819` ms dominates;
  rest of the bundle ≈ 14 s).
- 20:00 ingest captures the day's activity + stress + cardio data so the
  dashboard's evening review reflects today.
- Single daily sync (e.g. only 08:00) means the dashboard is always 12-23
  h stale during the active waking hours — bad UX.
- 4x daily or hourly: Gadgetbridge BLE polling on Android costs ~2-5 %
  battery per hour-long sync. Diminishing returns above 2x.
- Align with runner: launchd `WatchPaths` is mtime-driven, so the runner
  fires automatically on each push — no need for a cron alignment. The
  06:00 Sunday `StartCalendarInterval` in the plist
  (`pulse-runner.plist:14-21`) is a sensible weekly
  backstop for quiet days.

---

## 5. Architectural calls to make

- **Pi → Mac Ollama proxy via Tailscale.** Strong recommend. Set
  `OLLAMA_HOST=0.0.0.0` on the Mac so Ollama listens on the tailscale
  interface; set `Environment=OLLAMA_URL=http://mac-ts:11434` in
  `pulse.service`. Cost: ~50 ms RTT vs. ~0 from Mac browser; calls already
  take 26-90 s of model time so this is noise. The alternative (disable on
  Pi) leaves the Pi dashboard as a strict subset, which the user explicitly
  doesn't want for the Why? button.
- **Single-writer pulse.db.** Until Tailscale wires Pi→Mac for write-back,
  declare Pi read-only and hide write UI behind a runtime
  `process.env.PULSE_READONLY === "1"` flag (set in `pulse.service`). The
  Mac browser session keeps full functionality.
- **Move sharp into runner Dockerfile.** Current state is fine
  (only Next.js needs it) but if the runner ever takes over screenshot
  ingest (e.g. for a "process all queued screenshots" batch), it'll need
  `RUN apk add --no-cache vips-dev` plus the sharp npm dep.

---

## 6. Open questions

- Is Tailscale already deployed on both Mac and Pi? If yes, prefer the
  `OLLAMA_URL=http://mac-ts.<tailnet>.ts.net:11434` form. If no, are you OK
  with `mac.local` mDNS (LAN-only)?
- Should the Pi be allowed to write `pulse.db` at all? The deploy README
  describes Pi as "read-only" (line 9) but `lib/db-writable.ts` exists and
  is wired into server actions. Pick one — the current state is the worst
  of both worlds (silent Syncthing corruption risk).
- The `state/` Syncthing folder is described as bidirectional
  (`deploy/README.md:13`). It's JSON files written via tmp+rename in
  `lib/state-io.ts:59-65`, so atomic. Are you OK with the
  last-writer-wins resolution Syncthing does on conflict, or do you want
  alarm dismissals/labs flips to merge?
- Pi memory: have you actually run `npm run build && systemctl start
  pulse` on the Pi yet, or is this your first deploy? The 512 M cap is
  estimated; only real load tells.
- The `pulse-runner.sh` bootstrap (`deploy/pulse-runner.sh`) is referenced
  by the deploy README but **not invoked by the launchd plist or
  docker-compose**. Is this meant to be the entrypoint instead of `tsx
  src/index.ts daily-watch`? Currently dead code.
