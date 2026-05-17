# GPX Sync (Workout Maps)

Pulse renders GPS tracks for workouts from one of two sources:

1. **`CMF_WORKOUT_GPS_SAMPLE`** in Gadgetbridge.db — Colmi MF / CMF watches
   write lat/lon directly to the DB. Picked up automatically by
   `lib/queries/workouts.ts:getCmfGpsSamples` — no extra config.

2. **GPX files** referenced by `HUAWEI_WORKOUT_SUMMARY_SAMPLE.GPX_FILE_LOCATION`.
   Huawei watches store GPS as `.gpx` on the **phone's local filesystem**:

   ```
   /storage/emulated/0/Android/data/nodomain.freeyourgadget.gadgetbridge/files/<MAC>/workout_<n>_<unixSec>.gpx
   ```

   Pulse runs on a Mac (runner) + Pi (dashboard) — neither has access to that
   path. To enable maps you must mirror the Gadgetbridge folder into Pulse's
   data directory.

## Mirroring with Syncthing

1. **On the phone**, install Syncthing and add the folder
   `/storage/emulated/0/Android/data/nodomain.freeyourgadget.gadgetbridge/files`
   as a **send-only** share (read-only, your phone is the source of truth).

2. **On the Mac/Pi**, accept that share into a directory matching the layout
   Pulse expects:

   ```
   $PULSE_ROOT/gpx/<MAC>/workout_<n>_<unixSec>.gpx
   ```

   `$PULSE_ROOT` is the Syncthing root used by the dashboard
   (default `~/pulse` on Mac,
   `$PULSE_ROOT` on Pi).

3. The lookup tries three layouts (`lib/queries/gpx.ts`):
   - `$PULSE_ROOT/gpx/<basename>` — flat
   - `$PULSE_ROOT/gpx/<MAC>/<basename>` — preferred (matches phone layout)
   - `$PULSE_ROOT/<basename>` — last resort

   Any of those works; pick the simplest you can sustain.

4. Syncthing typically runs a few minutes behind real-time, which is fine —
   the dashboard re-reads the file each time `/workouts/[id]` is requested
   (no cache).

## Verifying

```bash
# On Pi (or Mac):
ls "$PULSE_ROOT/gpx/" | head
# Should list workout_*.gpx after the first sync.

curl -s http://localhost:3030/workouts/1 | grep -i "GPS-Track" && echo "map active"
```

If the file is mirrored but the page still shows the placeholder, check the
server logs for parse failures (the regex parser tolerates malformed XML but
returns null when it finds <2 trackpoints).

## Privacy

- The OSM basemap fetches tiles from `tile.openstreetmap.org`. Your IP is
  visible to that server per request.
- For a fully-local view, pick **"Aus"** in the layer toggle — only the
  trail polyline renders, no tile traffic.
- To self-host tiles, set `NEXT_PUBLIC_PULSE_MAP_TILES_URL` (and optionally
  `NEXT_PUBLIC_PULSE_MAP_TILES_ATTRIBUTION`) in `.env.local` or in the
  `pulse.service` `Environment=` block.

## Tile providers

- `osm` — `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- `topo` — `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png`
  (Use sparingly — OpenTopoMap asks for ≤2 req/s; the dashboard cache makes
  this fine for a single user.)
- `off` — render-only mode, no network.

The chosen layer is persisted to `localStorage` under `pulse:map:layer`.
