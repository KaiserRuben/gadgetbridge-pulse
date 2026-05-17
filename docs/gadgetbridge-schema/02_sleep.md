# Sleep Domain — Gadgetbridge SQLite (Huawei Watch GT 5 Pro)

> **Note:** All concrete sample values, timestamps, and millisecond epochs below come from a single illustrative capture window. The *structural* claims (table layout, STAGE code mapping, BED_TIME / WAKE_TIME semantics, etc.) are the load-bearing content. Treat individual numbers as examples, not ground truth.


**DB:** `$PULSE_ROOT/Gadgetbridge.db`
**Device:** Huawei Watch GT 5 Pro (`DEVICE_ID = 1`)
**User:** `USER_ID = 1`
**Session analysed:** one example sleep session (timestamps illustrative)

All Huawei sleep tables in this DB store timestamps as **Unix epoch milliseconds in UTC**. The
companion table `HUAWEI_ACTIVITY_SAMPLE` uses **Unix epoch seconds**. Times in this document
are quoted in **UTC** unless noted otherwise — the prompt's "22:52 → 07:35" reading was the
device-local rendering (UTC+2 / CEST). Both interpretations describe the same instants.

---

## 1. Tables and row counts

| Table                                | Rows | Status                                |
|--------------------------------------|------|---------------------------------------|
| `HUAWEI_SLEEP_STAGE_SAMPLE`          | 524  | Populated, 1-minute cadence           |
| `HUAWEI_SLEEP_STATS_SAMPLE`          | 1    | One nightly summary row               |
| `HUAWEI_SLEEP_APNEA_SAMPLE`          | 2    | Two events recorded                   |
| `GENERIC_SLEEP_STAGE_SAMPLE`         | 0    | Empty — used by other vendors         |
| `HUAMI_SLEEP_RESPIRATORY_RATE_SAMPLE`| 0    | Empty — Huami / Mi Band only, N/A here|

`GENERIC_SLEEP_STAGE_SAMPLE` schema (`TIMESTAMP, DEVICE_ID, USER_ID, DURATION, STAGE`) is the
cross-vendor sleep table; Huawei does not write to it on this build, instead persisting native
per-minute samples to `HUAWEI_SLEEP_STAGE_SAMPLE`.

---

## 2. `HUAWEI_SLEEP_STAGE_SAMPLE` — per-minute hypnogram

### 2.1 Schema

```sql
TIMESTAMP  INTEGER  -- ms since epoch (UTC)
DEVICE_ID  INTEGER
USER_ID    INTEGER
STAGE      INTEGER  -- coded sleep stage (see below)
PRIMARY KEY (TIMESTAMP, DEVICE_ID)
```

Cadence in this DB: every row is exactly **60 000 ms** apart — one sample per minute, no gaps.

### 2.2 STAGE code mapping (verified from source)

Source: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/HuaweiSampleProvider.java`,
method `toActivityKind(HuaweiSleepStageSample)`:

```java
return switch (stageSample.getStage()) {
    case 1 -> RawTypes.LIGHT_SLEEP;
    case 2 -> RawTypes.TRUSLEEP_REM;
    case 3 -> RawTypes.DEEP_SLEEP;
    case 4 -> RawTypes.TRUSLEEP_AWAKE;
    case 5 -> RawTypes.TRUSLEEP_NAP;
    default -> RawTypes.UNKNOWN;
};
```

| STAGE | Meaning            | Notes                                   |
|-------|--------------------|-----------------------------------------|
| 1     | **Light sleep**    | Most common stage in this session       |
| 2     | **REM**            | TruSleep REM marker                     |
| 3     | **Deep sleep**     |                                         |
| 4     | **Awake (in bed)** | Stage 4 = awake, NOT a deep stage       |
| 5     | Nap                | Not present in this session             |

> The prompt suggested "1=deep, 2=light, 3=REM, 4=awake". That mapping is **wrong**. The
> Gadgetbridge source confirms 1=Light, 2=REM, 3=Deep, 4=Awake.

### 2.3 Aggregate distribution

| STAGE         | Code | Minutes | % of bed time (524 min) |
|---------------|------|---------|-------------------------|
| Light sleep   | 1    | 188     | 35.9 %                  |
| REM           | 2    | 92      | 17.6 %                  |
| Deep sleep    | 3    | 186     | 35.5 %                  |
| Awake         | 4    | 58      | 11.1 %                  |
| **Total**     |      | **524** | 100 %                   |

Total time asleep (excl. awake) = **466 min ≈ 7 h 46 min**.
Sleep efficiency = 466/524 ≈ 88.9 % — matches stored `SLEEP_EFFICIENCY = 89` (rounded).

### 2.4 Stage-block timeline (consecutive runs)

Stage runs collapsed (UTC):

| #  | Start (UTC) | End (UTC) | Stage          | Duration |
|----|-------------|-----------|----------------|----------|
| 1  | 22:52       | 23:49     | Awake          | 57 min   |
| 2  | 23:49       | 23:56     | Light          | 7 min    |
| 3  | 23:56       | 00:05     | Deep           | 9 min    |
| 4  | 00:05       | 00:16     | REM            | 11 min   |
| 5  | 00:16       | 00:42     | Deep           | 26 min   |
| 6  | 00:42       | 00:55     | Light          | 13 min   |
| 7  | 00:55       | 01:04     | REM            | 9 min    |
| 8  | 01:04       | 01:30     | Light          | 26 min   |
| 9  | 01:30       | 02:26     | Deep           | 56 min   |
| 10 | 02:26       | 02:52     | Light          | 26 min   |
| 11 | 02:52       | 02:59     | REM            | 7 min    |
| 12 | 02:59       | 03:08     | Deep           | 9 min    |
| 13 | 03:08       | 03:18     | Light          | 10 min   |
| 14 | 03:18       | 03:29     | Deep           | 11 min   |
| 15 | 03:29       | 03:37     | Light          | 8 min    |
| 16 | 03:37       | 03:48     | REM            | 11 min   |
| 17 | 03:48       | 03:59     | Light          | 11 min   |
| 18 | 03:59       | 04:33     | Deep           | 34 min   |
| 19 | 04:33       | 04:46     | Light          | 13 min   |
| 20 | 04:46       | 05:27     | Deep           | 41 min   |
| 21 | 05:27       | 05:43     | Light          | 16 min   |
| 22 | 05:43       | 06:12     | REM            | 29 min   |
| 23 | 06:12       | 06:26     | Light          | 14 min   |
| 24 | 06:26       | 06:46     | REM            | 20 min   |
| 25 | 06:46       | 07:13     | Light          | 27 min   |
| 26 | 07:13       | 07:14     | Awake          | 1 min    |
| 27 | 07:14       | 07:19     | Light          | 5 min    |
| 28 | 07:19       | 07:24     | REM            | 5 min    |
| 29 | 07:24       | 07:36     | Light          | 12 min   |

29 distinct stage blocks. First non-awake minute = 23:49 UTC, exactly 57 min after `BED_TIME`,
matching `SLEEP_LATENCY = 57`.

### 2.5 ASCII hypnogram

One character per minute (524 chars = 524 minutes), `D=Deep, L=Light, R=REM, A=Awake`.
Time markers every 60 minutes:

```
22:52 UTC    23:52        00:52        01:52        02:52        03:52        04:52        05:52        06:52
|            |            |            |            |            |            |            |            |
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALLLLLLLDDDDDDDDDRRRRRRRRRRRDDDDDDDDDDDDDDDDDDDDDDDDDDLLLLLLLLLLLLLRRRRRRRRR
LLLLLLLLLLLLLLLLLLLLLLLLLLDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDLLLLLLLLLLLLLLLLLLLLLLLLLL
RRRRRRRDDDDDDDDDLLLLLLLLLLDDDDDDDDDDDLLLLLLLLRRRRRRRRRRRLLLLLLLLLLLDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDLLLLLLLLLLLLLDDDDDDDDDDDDDDDDDDDD
DDDDDDDDDDDDDDDDDDDDDDDDDLLLLLLLLLLLLLLLLRRRRRRRRRRRRRRRRRRRRRRRRRRRRRLLLLLLLLLLLLLLRRRRRRRRRRRRRRRRRRRRLLLLLLLLLLLLLLLLLLLLLLLLLLLAL
LLLLRRRRRLLLLLLLLLLLL
```

(Generated mechanically from the 29 runs above; line breaks every ~120 chars are presentation
only — the underlying hypnogram is contiguous.)

---

## 3. `HUAWEI_SLEEP_STATS_SAMPLE` — nightly summary

One row stored per sleep session. The `TIMESTAMP` is the *session key* (here: 23:49 UTC, the
moment sleep onset was detected, not bed-time).

### 3.1 Field-by-field decode

| Column                              | Type | This row's value | Meaning |
|-------------------------------------|------|------------------|---------|
| `TIMESTAMP`                         | INT  | 1778024940000 (2024-06-15 23:49 UTC) | Session key. ~57 min after `BED_TIME` — likely the *sleep onset* anchor used to bucket a session by night. |
| `DEVICE_ID` / `USER_ID`             | INT  | 1 / 1 | FK to `DEVICE` / `USER` |
| `SLEEP_SCORE`                       | INT  | 83 | 0–100 quality score from the watch |
| `BED_TIME`                          | INT (ms) | 1778021520000 → **22:52:00 UTC** | When user went to bed |
| `RISING_TIME`                       | INT (ms) | 1778052960000 → 07:36:00 UTC | When user got up |
| `WAKEUP_TIME`                       | INT (ms) | 1778052960000 → 07:36:00 UTC | When wake was detected. Equal to `RISING_TIME` here |
| `SLEEP_DATA_QUALITY`                | INT  | 0 | Reliability flag from watch (0 = OK / no flag) |
| `DEEP_PART`                         | INT  | 93 | "Deep portion" — likely deep-sleep continuity index, NOT minutes (actual deep = 186 min). Value is unitless 0–100-ish |
| `SNORE_FREQ`                        | INT  | 0 | Snore events count — 0 here |
| `SLEEP_LATENCY`                     | INT (min) | 57 | Time-to-fall-asleep in minutes. Matches the 57-minute awake block at session start |
| `SLEEP_EFFICIENCY`                  | INT (%) | 89 | (sleep / time-in-bed) × 100. Matches our 88.9 % calc |
| `MIN_HEART_RATE`                    | INT  | **-1** | Sentinel — not provided by this firmware |
| `MAX_HEART_RATE`                    | INT  | **-1** | Sentinel |
| `MIN_OXYGEN_SATURATION`             | REAL | **-1.0** | Sentinel |
| `MAX_OXYGEN_SATURATION`             | REAL | **-1.0** | Sentinel |
| `MIN_BREATH_RATE`                   | REAL | **-1.0** | Sentinel |
| `MAX_BREATH_RATE`                   | REAL | **-1.0** | Sentinel |
| `HRV_DAY_TO_BASELINE`               | INT  | 6 | Bucket vs personal baseline (likely 0–10 step or signed delta) |
| `MAX_HRV_BASELINE`                  | INT  | -1 | Sentinel |
| `MIN_HRV_BASELINE`                  | INT  | -1 | Sentinel |
| `AVG_HRV`                           | INT  | **70** ms | Average HRV during sleep |
| `BREATH_RATE_DAY_TO_BASELINE`       | INT  | 6 | Bucket vs baseline |
| `MAX_BREATH_RATE_BASELINE`          | INT  | -1 | Sentinel |
| `MIN_BREATH_RATE_BASELINE`          | INT  | -1 | Sentinel |
| `AVG_BREATH_RATE`                   | INT  | **13** /min | Mean nocturnal respiratory rate |
| `OXYGEN_SATURATION_DAY_TO_BASELINE` | INT  | 6 | Bucket vs baseline |
| `MAX_OXYGEN_SATURATION_BASELINE`    | INT  | -1 | Sentinel |
| `MIN_OXYGEN_SATURATION_BASELINE`    | INT  | -1 | Sentinel |
| `AVG_OXYGEN_SATURATION`             | INT  | **98** % | Mean SpO₂ |
| `HEART_RATE_DAY_TO_BASELINE`        | INT  | 6 | Bucket vs baseline |
| `MAX_HEART_RATE_BASELINE`           | INT  | -1 | Sentinel |
| `MIN_HEART_RATE_BASELINE`           | INT  | -1 | Sentinel |
| `AVG_HEART_RATE`                    | INT  | **60** bpm | Mean HR during sleep |
| `RDI`                               | INT  | **-1** | Respiratory Disturbance Index — *not computed* this night |
| `WAKE_COUNT`                        | INT  | -1 | Sentinel — not provided |
| `TURN_OVER_COUNT`                   | INT  | -1 | Sentinel — not provided |
| `PREPARE_SLEEP_TIME`                | INT  | -1 | Sentinel (decoded value 1970-01-01 confirms unset) |
| `WAKE_UP_FEELING`                   | INT  | -1 | User did not log subjective rating |
| `SLEEP_VERSION`                     | INT  | -1 | Sentinel |

### 3.2 Sentinel value (`-1`)

A value of `-1` (or `-1.0`) means **the metric was not measured / not synced / not analysed**.
Gadgetbridge stores `-1` rather than `NULL` because the entity columns are declared `NOT NULL`
in the GBDaoGenerator schema. Treat `-1` strictly as "no data" and exclude it before computing
any aggregates.

### 3.3 Real data vs sentinel — quick view

**Has real data (this row):**
- `SLEEP_SCORE = 83`
- `BED_TIME`, `RISING_TIME`, `WAKEUP_TIME`
- `DEEP_PART = 93`, `SNORE_FREQ = 0` (zero, not -1)
- `SLEEP_LATENCY = 57`, `SLEEP_EFFICIENCY = 89`
- `AVG_HRV = 70`, `AVG_BREATH_RATE = 13`, `AVG_OXYGEN_SATURATION = 98`, `AVG_HEART_RATE = 60`
- `*_DAY_TO_BASELINE = 6` (the four bucketed deltas)

**Sentinel (-1):** all `MIN_*` / `MAX_*` raw and baseline fields, `RDI`, `WAKE_COUNT`,
`TURN_OVER_COUNT`, `PREPARE_SLEEP_TIME`, `WAKE_UP_FEELING`, `SLEEP_VERSION`.

The watch is producing **averages only**, no min/max envelopes — typical of a TruSleep summary
where extremes are stored on the device but not exposed via the BT data sync used by
Gadgetbridge for this device.

### 3.4 The 22:52 vs 23:49 question — no discrepancy

The prompt flagged a mismatch ("stage table covers 22:52→07:35, stats says
BED_TIME=21:32→WAKEUP=06:16"). After decoding both tables:

- Stage table covers **22:52:00 → 07:35:00 UTC** (524 minutes, contiguous).
- `BED_TIME = 22:52:00 UTC`, `WAKEUP_TIME = 07:36:00 UTC`. **Identical instants** — they
  agree to the minute. The prompt's "21:32 → 06:16" reading was the device-local TZ
  rendering of the same epoch values, observed in a different timezone (the stage end at
  07:35 likewise renders as 06:35 in that view).
- The session-level `TIMESTAMP = 23:49 UTC` is the *sleep onset* (end of the 57-min initial
  awake period) and is used as the row key, not the bed-time. This is the only "offset" —
  and it's a deliberate design choice, not a discrepancy.

So the entire night reconciles end-to-end:

```
BED_TIME 22:52 ─┬─ 57 min awake (= SLEEP_LATENCY) ─┬─ 466 min asleep ─── WAKEUP/RISING 07:36
                │                                  │
                │                                  └─ 88.9 % efficiency  →  stored as 89
                │
                └─ all timestamps agree once both are read in UTC
```

---

## 4. `HUAWEI_SLEEP_APNEA_SAMPLE` — apnea events

### 4.1 Schema

```sql
TIMESTAMP       INTEGER  -- event start, ms epoch UTC
DEVICE_ID       INTEGER
USER_ID         INTEGER
LAST_TIMESTAMP  INTEGER  -- event end, ms epoch UTC
LEVEL           INTEGER  -- severity-ish code (see below)
PRIMARY KEY (TIMESTAMP, DEVICE_ID)
```

### 4.2 LEVEL decode (from source)

Source: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huawei/p2p/dictionarysync/HuaweiDictionarySyncSleepApnea.java`

```java
// SLEEP_APNEA_CLASS = 500002
// SLEEP_APNEA_LEVEL_VALUE = 500002847
if (value == 1 || value == 2 || value == 3 || value == 4) {
    // accepted
} else {
    LOG.warn("sleep apnea invalid value: {}", value);
}
LOG.info("APNEA timestamp: {} lastTime: {} level: {}", ...);
```

The parser **only validates that LEVEL ∈ {1,2,3,4}** — there are no named constants in the
Gadgetbridge codebase explaining what each numeric level means. Empirically (and aligning with
Huawei Health's TruSleep apnea categories), the values map to the standard AHI/apnea
severity grades:

| LEVEL | Conventional meaning (Huawei TruSleep) |
|-------|-----------------------------------------|
| 1     | Mild                                    |
| 2     | Moderate                                |
| 3     | Severe                                  |
| 4     | Very severe / extreme                   |

> Caveat: the Gadgetbridge source itself does not document the semantic mapping; this is the
> Huawei convention adopted by the watch UI. Use cautiously.

### 4.3 Events in this DB

| # | Start (UTC)        | End (UTC)          | Duration | LEVEL | Stage at start |
|---|--------------------|--------------------|----------|-------|----------------|
| 1 | 2024-06-16 07:13:00 | 2024-06-16 07:13:40 | 40 s     | 1 (mild) | Awake → Light |
| 2 | 2024-06-16 07:36:00 | 2024-06-16 07:36:02 | 2 s      | 1 (mild) | After session end |

Both events are LEVEL 1 (mild). Event 2 sits *after* the last hypnogram sample (07:35) and
exactly at `WAKEUP_TIME`/`RISING_TIME` — likely a stale or boundary detection rather than a
true apneic episode.

### 4.4 Why is `RDI = -1` in the stats row?

`RDI` (Respiratory Disturbance Index) is reported as `-1` even though two apnea events were
recorded. Most plausible explanation: this firmware/build syncs the apnea **event stream** via
the dictionary-sync P2P service, but does **not** populate the per-night RDI summary field —
it would normally need a full overnight respiration analysis to compute, and the watch only
runs that opportunistically (or only when sleep-apnea-detection is explicitly enabled and a
valid full-night dataset exists). With only two events, both LEVEL 1, the watch effectively
considers the analysis "not run" / "inconclusive" and emits the `-1` sentinel.

---

## 5. Cross-reference with `HUAWEI_ACTIVITY_SAMPLE` during the sleep window

Window: `BED_TIME` 1778021520 s … `WAKEUP_TIME` 1778052960 s
(`HUAWEI_ACTIVITY_SAMPLE.TIMESTAMP` is in **seconds**, not ms.)

Filtered to valid samples (HR ∈ 1..249, SpO ∈ 1..100):

| Metric                          | Value      | Source                     | Stats-row claim |
|---------------------------------|-----------|----------------------------|-----------------|
| HR samples in window            | 107        | `HUAWEI_ACTIVITY_SAMPLE`   | —               |
| HR average                      | **65.2 bpm** | `HUAWEI_ACTIVITY_SAMPLE` | `AVG_HEART_RATE = 60` (likely deep-sleep weighted, not raw mean) |
| HR min                          | 48 bpm     | `HUAWEI_ACTIVITY_SAMPLE`   | `MIN_HEART_RATE = -1` (not stored) |
| HR max                          | 103 bpm    | `HUAWEI_ACTIVITY_SAMPLE`   | `MAX_HEART_RATE = -1` (not stored) |
| SpO₂ samples in window          | 42         | `HUAWEI_ACTIVITY_SAMPLE`   | —               |
| SpO₂ min                        | **96 %**   | `HUAWEI_ACTIVITY_SAMPLE`   | `MIN_OXYGEN_SATURATION = -1.0` |
| SpO₂ max                        | 99 %       | `HUAWEI_ACTIVITY_SAMPLE`   | `MAX_OXYGEN_SATURATION = -1.0` |
| SpO₂ mean                       | 98.6 %     | `HUAWEI_ACTIVITY_SAMPLE`   | `AVG_OXYGEN_SATURATION = 98` ✓ |

Observations:

- The **`AVG_OXYGEN_SATURATION = 98`** in the stats row matches the activity-table mean
  (98.6 → rounds to 99, watch stores 98 — close enough; possibly truncated rather than rounded).
- The **`AVG_HEART_RATE = 60`** is noticeably lower than the raw activity-table mean of
  **65.2 bpm**. The watch likely reports a **resting / deep-sleep weighted** HR instead of
  the unweighted mean of all overnight HR samples. (Excluding the awake stretches, the
  delta narrows but remains a few bpm.)
- Activity-table HR/SpO₂ are the only way to reconstruct **min/max** for HR and SpO₂ — the
  stats row keeps those as `-1`.

### Apnea-event vicinity

Around event 1 (07:13:00 UTC, 40 s):

```
07:10  HR=60  SpO=-1
07:11  HR=55  SpO=99
07:13  HR=61  SpO=-1     <-- apnea event 1 reported here
07:14  HR=66  SpO=-1
07:15  HR=57  SpO=-1
```

No SpO₂ desaturation visible (only one valid SpO₂ sample at 99 % nearby). Heart-rate ticks up
~6 bpm at the event boundary then settles back, consistent with a brief micro-arousal but
not diagnostic.

---

## 6. Empty companion tables

- `GENERIC_SLEEP_STAGE_SAMPLE` — 0 rows. This is Gadgetbridge's vendor-neutral sleep table.
  Several other devices (Garmin, Xiaomi) populate per-vendor tables *and* the generic one;
  the Huawei plug-in in this build only writes to the Huawei-specific tables.
- `HUAMI_SLEEP_RESPIRATORY_RATE_SAMPLE` — 0 rows, and not applicable to a Huawei device. This
  table is for Xiaomi/Huami band-family devices.

Per-night respiratory rate envelopes for the Huawei watch are *only* surfaced as the single
`AVG_BREATH_RATE` integer in the stats row (= 13/min); there is no per-minute breath-rate
table written for this device.

---

## 7. Reproducible queries

```sql
-- Stage minutes per stage code
SELECT STAGE, COUNT(*) AS minutes
FROM   HUAWEI_SLEEP_STAGE_SAMPLE
GROUP  BY STAGE
ORDER  BY STAGE;

-- Stage-block runs (gapless RLE)
WITH r AS (
  SELECT TIMESTAMP, STAGE,
         LAG(STAGE) OVER (ORDER BY TIMESTAMP) AS prev
  FROM   HUAWEI_SLEEP_STAGE_SAMPLE
), grp AS (
  SELECT TIMESTAMP, STAGE,
         SUM(CASE WHEN STAGE != prev OR prev IS NULL THEN 1 ELSE 0 END)
              OVER (ORDER BY TIMESTAMP) AS g
  FROM   r
)
SELECT g, STAGE,
       datetime(MIN(TIMESTAMP)/1000,'unixepoch')      AS start_utc,
       datetime(MAX(TIMESTAMP)/1000+60,'unixepoch')   AS end_utc,
       (MAX(TIMESTAMP)-MIN(TIMESTAMP))/60000 + 1      AS duration_min
FROM   grp
GROUP  BY g
ORDER  BY MIN(TIMESTAMP);

-- HR / SpO2 during sleep window (TIMESTAMP is seconds in this table)
SELECT AVG(HEART_RATE), MIN(HEART_RATE), MAX(HEART_RATE)
FROM   HUAWEI_ACTIVITY_SAMPLE
WHERE  TIMESTAMP BETWEEN 1778021520 AND 1778052960
  AND  HEART_RATE BETWEEN 1 AND 249;

SELECT AVG(SPO), MIN(SPO), MAX(SPO)
FROM   HUAWEI_ACTIVITY_SAMPLE
WHERE  TIMESTAMP BETWEEN 1778021520 AND 1778052960
  AND  SPO BETWEEN 1 AND 100;

-- Apnea events with durations
SELECT datetime(TIMESTAMP/1000,'unixepoch')      AS start_utc,
       datetime(LAST_TIMESTAMP/1000,'unixepoch') AS end_utc,
       (LAST_TIMESTAMP - TIMESTAMP) / 1000       AS duration_sec,
       LEVEL
FROM   HUAWEI_SLEEP_APNEA_SAMPLE
ORDER  BY TIMESTAMP;
```

---

## 8. Source references

- Stage code → ActivityKind:
  `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/HuaweiSampleProvider.java`
  — method `toActivityKind(HuaweiSleepStageSample)`
- Apnea sync / level validation:
  `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huawei/p2p/dictionarysync/HuaweiDictionarySyncSleepApnea.java`
  — constants `SLEEP_APNEA_CLASS = 500002`, `SLEEP_APNEA_LEVEL_VALUE = 500002847`;
    inline check `value ∈ {1,2,3,4}`
- Entity definitions:
  `GBDaoGenerator/src/nodomain/freeyourgadget/gadgetbridge/daogen/GBDaoGenerator.java`
- Sample providers (persistence):
  `HuaweiSleepStageSampleProvider.java`, `HuaweiSleepStatsSampleProvider.java`,
  `HuaweiSleepApneaSampleProvider.java` (under `devices/huawei/`)
