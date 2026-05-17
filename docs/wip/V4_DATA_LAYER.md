# Pulse v4 — Data layer rework

Replaces the file-tree insights + bidirectional Syncthing state with a
single-writer Pi-side SQLite DB and HTTP ingest from the Mac runner.

## Why

The v3 layout stored insights as files under `/data/insights/...` synced
bidirectionally through Syncthing, alongside `pulse.db` and `state/*.json`.
This blocked user-write features (mood, notes, "how do I feel") because
running both Mac (runner) and Pi (dashboard) as concurrent SQLite writers
risks WAL corruption.

It also delayed visibility: the dashboard read insight files via mtime hot
reload, but no live update fired — so wake-up numbers only appeared on the
next page refresh, after the full LLM pipeline finished.

## New shape

```
Phone ─Syncthing─► Mac (raw Gadgetbridge.db only)
                          │
                          ▼
                  ┌──────────────────────┐
                  │ Mac runner (worker)  │
                  │  • watches GB.db     │
                  │  • Stage 0/1 NOW     │
                  │  • POSTs each stage  │ ─HTTP─► Pi
                  │  • LLM via Ollama    │  /api/ingest/*
                  │  • outbox SQLite if  │  Bearer auth
                  │    Pi unreachable    │
                  └──────────────────────┘
                                           ┌───────────────────────┐
                                           │ Pi (single writer)    │
                                           │  • pulse.db (WAL)     │
                                           │  • Next.js dashboard  │
                                           │    (pure SSR)         │
                                           │  • user write surface │
                                           └───────────────────────┘
```

Syncthing now only carries `Gadgetbridge.db` (phone → Mac). The Pi data
volume is owned by the Pi alone.

## Tables (migration M007_period_store)

| Table | Purpose |
|-------|---------|
| `PULSE_FACTS` | Pre-processed numbers (Stage 0/1). Status `live` mid-day, `locked` after finalize. |
| `PULSE_INSIGHT(cluster, version, status)` | Per-cluster LLM payload. Each cluster writes its row when ready. |
| `PULSE_BUNDLE` | Pipeline status + per-stage timings + verify result. |
| `PULSE_STATE_KV` | Replaces `pause.json` / `labs.json` / `alarm_state.json`. |
| `PULSE_ALARM_EVENT` | Replaces `alarms/YYYY-MM/alarms.json`. |
| `PULSE_EVENT_LOG` | Replaces `state/events.jsonl`. |
| `PULSE_INGEST_LOG` | Idempotency-key dedupe for HTTP ingest. |

## Ingest API

`POST /api/ingest/{facts,insight,bundle,alarm,state,event}`

Bearer `INGEST_TOKEN`. Add `Idempotency-Key` header for safe replay; the
Mac runner sends a deterministic key per payload hash so retries from the
local outbox can't double-insert.

Bodies (`Record<string, unknown>`):

- `facts`: `{ periodKey, status: "live"|"locked", payload, source? }`
- `insight`: `{ periodKey, cluster, status, payload, source? }`
- `bundle`: `{ periodKey, pipeline?: "v2"|"v3", status, stages, verify? }`
- `alarm`: `{ id, periodKey, tsIso, kind, severity, payload }`
- `state`: `{ key, value }`
- `event`: `{ id, kind, periodKey, tsMs, payload }`

Writes land in pulse.db. The dashboard is pure SSR: every page uses
`unstable_noStore()` and re-reads the relevant row / JSON file on each
request, so freshness comes for free without any push channel.

## Progressive disclosure on the dashboard

Server components read pulse.db row-by-row through `lib/data/period-store.ts`,
falling back to insight JSON on disk when no row is present yet. Reloading
the page picks up whatever the runner POSTed last.

## Configuration

Mac runner `.env`:

```
PULSE_INGEST_BASE_URL=http://pulse.<tailnet>.ts.net:3030
PULSE_INGEST_TOKEN=<shared-secret>
```

Pi dashboard `.env`:

```
INGEST_TOKEN=<same shared-secret>
```

Leave `PULSE_INGEST_BASE_URL` empty to keep the runner in legacy file-only
mode (every push helper short-circuits with `ok: true`).

## Backfill

After standing up the new endpoints on the Pi, replay every existing
insight + state file into the DB:

```bash
cd runner
PULSE_INGEST_BASE_URL=http://pulse.<tailnet>.ts.net:3030 \
PULSE_INGEST_TOKEN=... \
npx tsx src/scripts/ingest-backfill.ts --limit=120
```

Idempotent — re-runs are safe.

## Syncthing migration

Once the Pi DB is populated, the data folder can shed everything except
`Gadgetbridge.db`. Recommended `.stignore` for the data folder
(`~/pulse` on the Mac,
`$PULSE_ROOT` on the Pi):

```
insights/
state/
pulse.db
pulse.db-wal
pulse.db-shm
ingest-outbox.db
```

Apply via the Syncthing UI (Folder → Ignore Patterns). The Mac keeps
local copies (it still writes them in legacy mode), but they no longer
replicate.

## Rollback

1. Drop `PULSE_INGEST_BASE_URL` from the Mac runner env — every push
   helper short-circuits, runner stays in legacy mode.
2. Remove the Pi `.stignore` rules above so Syncthing resumes carrying
   `insights/` + `state/`.
3. The dashboard reads pulse.db rows first, then falls back to files — so
   pages keep rendering either way during the transition.
