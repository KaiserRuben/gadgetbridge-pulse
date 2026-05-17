# Gadgetbridge: ACTIVITY Domain (Huawei Watch GT 5 Pro)

> **Note:** All concrete sample values, timestamps, and millisecond epochs below come from a single illustrative capture window. The *structural* claims (column meanings, sentinel encoding, pair encoding, signed-byte overflow, etc.) are the load-bearing content. Treat individual numbers as examples, not ground truth.


Source DB: `$PULSE_ROOT/Gadgetbridge.db`
Device row: `_id=1`, `NAME="HUAWEI WATCH GT 5 Pro"`, `MANUFACTURER=Huawei`, `TYPE_NAME=HUAWEIWATCHGT5`, `MODEL=Vili-B29F`, `IDENTIFIER=XX:XX:XX:XX:XX:XX`.
Reference Java sources: `nodomain.freeyourgadget.gadgetbridge.entities.HuaweiActivitySample`, `nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiSampleProvider`.

Tables in scope:

- `HUAWEI_ACTIVITY_SAMPLE` — ~1900 rows (example capture)
- `BATTERY_LEVEL` — ~20 rows

Example capture window (UTC): ~16h 03m. All concrete timestamps below are illustrative.

---

## 1. `HUAWEI_ACTIVITY_SAMPLE` schema

```
CREATE TABLE HUAWEI_ACTIVITY_SAMPLE (
  TIMESTAMP          INTEGER NOT NULL,
  DEVICE_ID          INTEGER NOT NULL,
  USER_ID            INTEGER NOT NULL,
  OTHER_TIMESTAMP    INTEGER NOT NULL,
  SOURCE             INTEGER NOT NULL,
  RAW_KIND           INTEGER NOT NULL,
  RAW_INTENSITY      INTEGER NOT NULL,
  STEPS              INTEGER NOT NULL,
  CALORIES           INTEGER NOT NULL,
  DISTANCE           INTEGER NOT NULL,
  SPO                INTEGER NOT NULL,
  HEART_RATE         INTEGER NOT NULL,
  RESTING_HEART_RATE INTEGER NOT NULL,
  PRIMARY KEY (TIMESTAMP, DEVICE_ID, OTHER_TIMESTAMP, SOURCE) ON CONFLICT REPLACE
) WITHOUT ROWID;
```

The composite PK on `(TIMESTAMP, DEVICE_ID, OTHER_TIMESTAMP, SOURCE)` is essential — the same `TIMESTAMP` legitimately appears multiple times.

### Column meanings

| Column | Type | Meaning | Sentinel / scale |
|---|---|---|---|
| `TIMESTAMP` | unix epoch seconds (UTC) | Start-of-minute boundary for this sample. | always set; 60 s grid |
| `DEVICE_ID` | FK -> `DEVICE._id` | Originating device. | only `1` here |
| `USER_ID` | FK -> `USER._id` | Owning user. | only `1` here |
| `OTHER_TIMESTAMP` | unix epoch seconds | The other endpoint of the minute interval (typically `TIMESTAMP +/- 60`). Used to encode the sample as an interval pair. | see "pair encoding" below |
| `SOURCE` | byte tag | Origin of the sample. `0x0b = 11` = step/activity stream from device, `0x0d = 13` = "sleep-from-activity" / workout boundary marker. | only 11 and 13 observed |
| `RAW_KIND` | byte | Activity classification (`RawTypes` in `HuaweiSampleProvider`). | see table below |
| `RAW_INTENSITY` | int | Presence/intensity flag, **not** a graduated scale on this firmware: `1` = activity slot present, `0` = idle, `-1` = NOT_MEASURED. | only `1` observed in this DB |
| `STEPS` | int | Step count for the minute. | `-1` = NOT_MEASURED, `0` = no steps, `>0` = actual count |
| `CALORIES` | int | Active calories for the minute. **Unit is not kcal.** Per-minute values up to 5990 are recorded — this is consistent with **deca-calories or with a small-J / cJ scale** (Huawei firmware reports "active calories" multiplied; Gadgetbridge passes through the raw value). Do NOT treat as kcal. | `-1` = NOT_MEASURED |
| `DISTANCE` | int | Distance in **cm** (DAO multiplies the protocol value by 100 — see `addHuaweiActivitySample` -> `distance ... *100`). | `-1` = NOT_MEASURED |
| `SPO` | int | SpO2 in percent (95..99 typical). | `-1` = NOT_MEASURED, no `0` values present |
| `HEART_RATE` | int | Instantaneous HR in bpm. | `-1` = NOT_MEASURED. Negative-non-`-1` values are **signed-byte overflow** of the wire HR byte (see anomalies). |
| `RESTING_HEART_RATE` | int | Resting HR in bpm, sparsely populated (5 rows only). | `-1` = NOT_MEASURED, `0` = "not yet computed" |

### `RAW_KIND` values (this DB)

| Value | Count | Meaning (per `HuaweiSampleProvider.RawTypes`) |
|---|---|---|
| `-1` | 1924 | `NOT_MEASURED` — generic per-minute activity sample slot. The whole minute-by-minute step/HR/SpO2 stream uses `-1`. |
| `1` | 18 | `UNKNOWN` — used here as a **sleep / wake-from-sleep marker** boundary (matches `SOURCE=13`). Confirmed by the paired `OTHER_TIMESTAMP=TIMESTAMP+/-60` structure and absence of metric data. |
| `2` | 2 | Workout boundary marker (single short workout in the dataset, `SOURCE=13`). |

Other constants defined in the upstream source but not seen here: `0x06` LIGHT_SLEEP, `0x07` DEEP_SLEEP, `0x5656` TRUSLEEP_REM, `0x5658` TRUSLEEP_AWAKE, `0x5659` TRUSLEEP_NAP — these would appear if/when proper sleep tracking data is synced from the device.

### `SOURCE` values (this DB)

| Value | Hex | Count | Meaning |
|---|---|---|---|
| 11 | `0x0b` | 1924 | Step / activity stream (per-minute); carries STEPS / CALORIES / DISTANCE / HEART_RATE / SPO. |
| 13 | `0x0d` | 20 | "Sleep-from-activity" / workout segment markers. **Carries no metric data** — every column except TIMESTAMP/OTHER_TIMESTAMP/RAW_KIND/SOURCE is the `-1` sentinel. |

### Pair encoding (critical for any aggregation)

For `SOURCE=11`, every minute is stored as **two rows**:

- **forward row**: `OTHER_TIMESTAMP = TIMESTAMP + 60`, carries the actual data (or `0`s for an idle minute, or `-1`s if the device returned no data for that slot).
- **backward row**: `OTHER_TIMESTAMP = TIMESTAMP - 60`, **always** has all data columns set to `-1` — it is the "tail" view of the previous minute's interval.

Counts confirm: 962 forward + 962 backward = 1924 `SOURCE=11` rows. Of forward rows, 962/962 carry real data; of backward rows, 0/962 carry data. The 20 `SOURCE=13` rows likewise come in 10 forward/backward pairs (`+/-60`, except one workout-related pair using `+/-180`).

**Aggregation rule**: filter `SOURCE=11 AND OTHER_TIMESTAMP=TIMESTAMP+60` to count each minute exactly once, or use `STEPS != -1` etc. Never `SUM(...)` over the whole table — the `-1` sentinels poison the totals (this is why the raw `SUM(STEPS)` is `-562`).

Minute coverage: 964 distinct minutes in 963-minute span -> **100% gapless** per-minute grid.

---

## 2. Step / calorie / distance aggregates by `RAW_KIND`

Raw `SUM` across the whole table (sentinel-poisoned, do not use for analysis):

| RAW_KIND | rows | SUM(STEPS) | SUM(CALORIES) | SUM(DISTANCE) |
|---|---|---|---|---|
| -1 | 1924 | -542 | 48167 | -494 |
| 1 | 18 | -18 | -18 | -18 |
| 2 | 2 | -2 | -2 | -2 |

Corrected totals (forward-only `SOURCE=11` rows, with sentinel exclusion):

| Metric | Total | Notes |
|---|---|---|
| Steps | **420** | only 12 of 962 forward minutes had STEPS > 0 |
| Calories (firmware unit) | **49,129** | not kcal — see column notes |
| Distance | **468** (cm) | = ~4.68 m total — note: per `addHuaweiActivitySample`, the DAO already scales the wire value by 100, so this is centimetres |

`RAW_KIND=1` and `RAW_KIND=2` rows contribute zero metric data (they are markers).

### Why `SUM(STEPS) = -562`

Each minute is double-recorded as a `(forward, backward)` pair. The backward row of every pair stores `STEPS = -1`. With 962 backward rows + 18 RAW_KIND=1 marker rows + 2 RAW_KIND=2 marker rows = **982 rows storing `-1`** for STEPS, contributing `-982`. The forward rows contribute `+420`. Result: `-982 + 420 = -562`. There is no negative-step measurement; every "negative" value is the `NOT_MEASURED` sentinel.

The 982 sentinel-`-1` step rows include:

- 962 backward pair rows (`OTHER_TIMESTAMP = TIMESTAMP - 60`, `SOURCE=11`)
- 18 sleep-marker rows (`RAW_KIND=1`, `SOURCE=13`)
- 2 workout-marker rows (`RAW_KIND=2`, `SOURCE=13`)

Sample of these "negative-steps" rows (`SOURCE=11` backward pairs, first 10):

| local time | OTHER_TIMESTAMP | direction | STEPS |
|---|---|---|---|
| 2024-06-15 19:34 | TIMESTAMP-60 | backward | -1 |
| 2024-06-15 19:35 | TIMESTAMP-60 | backward | -1 |
| 2024-06-15 19:36 | TIMESTAMP-60 | backward | -1 |
| 2024-06-15 19:37 | TIMESTAMP-60 | backward | -1 |
| 2024-06-15 19:38 | TIMESTAMP-60 | backward | -1 |
| ... | ... | ... | ... |

(All 962 backward rows look identical — they are mirror entries, not real data points.)

---

## 3. Hourly steps + calories (Europe/Berlin, UTC+2)

Forward-only `SOURCE=11` rows:

| Hour (local) | minutes | Steps | Calories (firmware) | Distance (cm) |
|---|---|---|---|---|
| 2024-06-15 19 | 27 | 0 | 0 | 0 |
| 2024-06-15 20 | 60 | 27 | 1,446 | 29 |
| 2024-06-15 21 | 60 | 10 | 1,352 | 12 |
| 2024-06-15 22 | 60 | 0 | 5,983 | 0 |
| 2024-06-15 23 | 60 | 0 | 2,219 | 0 |
| 2024-06-16 00 | 59 | 0 | 9,257 | 0 |
| 2024-06-16 01 | 60 | 0 | 485 | 0 |
| 2024-06-16 02 | 60 | 0 | 0 | 0 |
| 2024-06-16 03 | 60 | 0 | 0 | 0 |
| 2024-06-16 04 | 60 | 0 | 0 | 0 |
| 2024-06-16 05 | 60 | 0 | 0 | 0 |
| 2024-06-16 06 | 60 | 0 | 0 | 0 |
| 2024-06-16 07 | 60 | 0 | 0 | 0 |
| 2024-06-16 08 | 60 | 0 | 0 | 0 |
| 2024-06-16 09 | 60 | 0 | 50 | 0 |
| 2024-06-16 10 | 60 | 47 | 2,718 | 51 |
| 2024-06-16 11 | 36 | **336** | **25,619** | **376** |
| **TOTAL** | **962** | **420** | **49,129** | **468** |

Notable: the 11:00-11:36 local hour on 2024-06-16 dominates the day's activity (80% of steps, 52% of calories, 80% of distance) and contains the workout marker. The 22:00-01:00 calorie burn with zero steps is consistent with non-step activity (e.g. typing, eating, fidgeting) being scored by the firmware's accelerometer-driven energy estimator.

---

## 4. Heart-rate analysis

Filtered to `HEART_RATE > 0` (excludes `-1` NOT_MEASURED and one overflow anomaly).

Overall (n=284):

- min: **48 bpm**
- max: **126 bpm**
- mean: **76.7 bpm**
- median: **76.5 bpm**

### HR by hour of day (local)

| Hour | n | min | max | mean |
|---|---|---|---|---|
| 00 | 22 | 75 | 113 | 97.1 |
| 01 | 24 | 56 | 100 | 77.3 |
| 02 | 11 | 57 | 69 | 62.3 |
| 03 | 12 | 59 | 71 | 64.7 |
| 04 | 12 | 55 | 62 | 58.5 |
| 05 | 8 | 49 | 66 | 57.4 |
| 06 | 8 | 52 | 61 | 54.1 |
| 07 | 7 | 48 | 85 | 57.0 |
| 08 | 7 | 52 | 64 | 56.7 |
| 09 | 18 | 55 | 92 | 67.5 |
| 10 | 23 | 72 | 95 | 84.3 |
| 11 | 22 | 83 | 126 | 94.7 |
| 19 | 7 | 73 | 85 | 80.9 |
| 20 | 33 | 54 | 88 | 72.6 |
| 21 | 30 | 50 | 112 | 75.0 |
| 22 | 19 | 79 | 116 | 93.8 |
| 23 | 21 | 74 | 103 | 82.0 |

Curve makes physiological sense: nocturnal trough 04-08 local (~55-58 bpm), morning rise, peak during 11:00 workout (max 126 at 11:28).

### `RESTING_HEART_RATE` (separate aggregate)

Only **5 rows** have `RESTING_HEART_RATE > 0` (range 60..74). The column is overwhelmingly `0` ("not yet computed") rather than `-1`, suggesting the firmware sometimes attaches a resting-HR estimate to a single per-minute row and leaves it `0` elsewhere.

| local time | resting HR |
|---|---|
| 2024-06-15 20:47 | 66 |
| 2024-06-15 22:01 | 63 |
| 2024-06-16 01:06 | 74 |
| 2024-06-16 02:07 | 74 |
| 2024-06-16 09:15 | 60 |

These are sparse "snapshots" rather than a continuous series — treat them as point estimates published whenever the watch updated its resting-HR baseline.

---

## 5. SpO2 analysis

Filtered to `SPO > 0`. **Sentinel here is `-1`, not `0`**: the DB has 1885 rows with `SPO=-1`, **0 rows with `SPO=0`**, 59 rows with positive readings. No "0 vs -1" ambiguity for this device — every non-`-1` value is a real measurement.

Overall (n=59):

- min: **95 %**, max: **99 %**, mean: **98.07 %**

### SpO2 by hour of day

| Hour | n | min | max | mean |
|---|---|---|---|---|
| 00 | 3 | 95 | 99 | 97.0 |
| 02 | 5 | 98 | 99 | 98.6 |
| 03 | 6 | 98 | 99 | 98.3 |
| 04 | 6 | 99 | 99 | 99.0 |
| 05 | 6 | 98 | 99 | 98.3 |
| 06 | 5 | 96 | 99 | 98.2 |
| 07 | 6 | 99 | 99 | 99.0 |
| 08 | 6 | 99 | 99 | 99.0 |
| 09 | 2 | 98 | 99 | 98.5 |
| 11 | 1 | 96 | 96 | 96.0 |
| 19 | 1 | 97 | 97 | 97.0 |
| 20 | 2 | 97 | 98 | 97.5 |
| 21 | 1 | 98 | 98 | 98.0 |
| 22 | 4 | 95 | 96 | 95.3 |
| 23 | 5 | 96 | 99 | 97.0 |

Sleep-window SpO2 (02-09 local) is tight at 98-99 %, consistent with the watch's continuous sleep SpO2 mode being active overnight. Daytime is sparser (1-3 readings/hour) — these are likely on-demand or auto-spot measurements. The 22:00 cluster (95-96 %) and 00:00 (95) are the lowest readings, near sleep onset.

---

## 6. `BATTERY_LEVEL` timeline

Schema:

```
CREATE TABLE BATTERY_LEVEL (
  TIMESTAMP     INTEGER NOT NULL,
  DEVICE_ID     INTEGER NOT NULL,
  LEVEL         INTEGER NOT NULL,
  BATTERY_INDEX INTEGER NOT NULL,
  PRIMARY KEY (TIMESTAMP, DEVICE_ID, BATTERY_INDEX) ON CONFLICT REPLACE
) WITHOUT ROWID;
```

`BATTERY_INDEX=0` for all 20 rows — single-cell device, no auxiliary battery.

### Full timeline (Europe/Berlin)

| Local time | Level | delta | gap (min) | phase |
|---|---|---|---|---|
| 2024-06-15 19:33:14 | 100 | -- | -- | initial connect |
| 2024-06-15 19:33:57 | 100 | 0 | 0.7 | duplicate ping |
| 2024-06-15 19:40:40 | 100 | 0 | 6.7 |  |
| 2024-06-15 19:46:10 | 100 | 0 | 5.5 |  |
| 2024-06-15 19:46:11 | 100 | 0 | 0.0 | dup (1 s) |
| 2024-06-15 19:55:04 | 100 | 0 | 8.9 |  |
| 2024-06-15 19:55:07 | 100 | 0 | 0.1 | dup (3 s) |
| 2024-06-15 20:58:25 | 98 | -2 | 63.3 | discharge |
| 2024-06-15 21:58:26 | 97 | -1 | 60.0 | discharge |
| 2024-06-16 01:30:29 | 95 | -2 | 212.1 | discharge (overnight) |
| 2024-06-16 01:30:43 | 95 | 0 | 0.2 | dup (14 s) |
| 2024-06-16 02:30:58 | 95 | 0 | 60.3 | flat |
| 2024-06-16 06:01:33 | 94 | -1 | 210.6 | discharge |
| 2024-06-16 07:59:14 | 93 | -1 | 117.7 | discharge |
| 2024-06-16 08:59:24 | 93 | 0 | 60.2 | flat |
| 2024-06-16 09:35:46 | 93 | 0 | 36.4 | last pre-charge |
| **2024-06-16 10:37:53** | **100** | **+7** | 62.1 | **charge cycle complete** |
| 2024-06-16 11:31:00 | 100 | 0 | 53.1 |  |
| 2024-06-16 11:36:58 | 100 | 0 | 6.0 |  |
| 2024-06-16 11:59:16 | 100 | 0 | 22.3 |  |

### Discharge / charge summary

- **Discharge phase** 19:33 -> 09:35: 100 % -> 93 % over ~14h, **~0.5 %/h drain rate** (very low, watch was largely idle / sleeping).
- **Charge cycle**: between **09:35:46** (93 %) and **10:37:53** (100 %), so somewhere in that ~62-minute window the watch was on charger and topped up. No intermediate samples capture the ramp — this device only emits battery samples on round-hour-ish intervals or on connection events.
- **Post-charge**: 100 % held through 11:59.

Anomaly: the early reconnect cluster (5 rows within 22 minutes of session start) shows duplicate timestamps 0-3 s apart — same `LEVEL`, same `BATTERY_INDEX=0`. The PK avoids strict duplicates because TIMESTAMP differs by 1-3 s, but these are effectively the same event reported by overlapping characteristic notifications.

---

## 7. Data quality issues

| # | Issue | Detail |
|---|---|---|
| 1 | **`HEART_RATE = -125` overflow** | Single row (TIMESTAMP=1778059740, 2024-06-16 11:29 local) during the workout segment. `-125` (signed int8) = `0x83` = `131` unsigned. Almost certainly a signed-byte parse bug in Gadgetbridge's HR field handling for a value > 127 bpm. The same row also has `CALORIES = 5990` (highest in the dataset, also possibly a unit/overflow oddity). |
| 2 | **`CALORIES` unit mismatch** | Per-minute calorie values in the thousands (max 5990, hourly max 25619) cannot be kcal. Likely raw-unit pass-through (decicalories, or Huawei's internal unit). Document downstream that this is **not** kcal without a conversion factor. |
| 3 | **Sentinel-poisoned aggregates** | Naive `SUM` over `STEPS` / `CALORIES` / `DISTANCE` / `HEART_RATE` / `SPO` returns nonsense (e.g. `SUM(STEPS) = -562`) because of the 982 `-1` sentinel rows. Always filter `> 0` (or join on the forward pair) before aggregating. |
| 4 | **Pair-row double counting** | Each minute is stored twice (forward+backward pair). Aggregations must filter `OTHER_TIMESTAMP = TIMESTAMP + 60` (or `STEPS != -1` etc.) to avoid this. |
| 5 | **Mixed sentinel semantics for `RESTING_HEART_RATE`** | Uses both `-1` (NOT_MEASURED) and `0` ("not yet computed"). Only 5 of 1944 rows carry a real value. |
| 6 | **`RAW_INTENSITY` collapsed** | Every row has `RAW_INTENSITY = 1`. This firmware path doesn't differentiate — it's effectively a "row-exists" flag, not an intensity scale. |
| 7 | **No row gaps** | 964 distinct minute timestamps over 963 minutes — perfect grid coverage. No missing minutes. |
| 8 | **Duplicate battery samples** | Five battery rows within 22 minutes of session start are duplicates (1-3 s apart, identical LEVEL). Harmless but inflates the row count beyond what represents distinct battery events. |
| 9 | **No actual sleep stages** | `RAW_KIND` only contains `-1`, `1`, `2` — no `0x06`/`0x07` deep/light values, no `0x5656`/`0x5658`/`0x5659` TruSleep states. Sleep stage data, if any, lives in `HUAWEI_SLEEP_STAGE_SAMPLE` / `HUAWEI_SLEEP_STATS_SAMPLE` (separate tables). |
| 10 | **Tiny dataset window** | Only ~16 hours of data — single overnight + morning workout. Any longitudinal pattern is anecdotal at this size. |
| 11 | **PK `ON CONFLICT REPLACE`** | Re-syncing the same window from the watch silently overwrites earlier rows with the same composite key. Means historical data integrity depends on consistent `OTHER_TIMESTAMP`/`SOURCE` reporting from the firmware. |
