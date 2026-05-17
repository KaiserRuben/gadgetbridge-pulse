# 03 — Biometrics / Specialty Metrics

> **Note:** All concrete sample values, timestamps, and millisecond epochs below come from a single illustrative capture window. The *structural* claims (column meanings, present / absent tables, encoding) are the load-bearing content. Treat individual numbers as examples, not ground truth.


Source database: `$PULSE_ROOT/Gadgetbridge.db`
Device: `HUAWEI WATCH GT 5 Pro` (DEVICE._id = 1, IDENTIFIER `XX:XX:XX:XX:XX:XX`, MODEL `Vili-B29F`)
User: USER._id = 1
Coverage window: ~16 h example sync (timestamps below are illustrative).

This document covers all non-activity, non-sleep, non-workout biometric tables: skin
temperature, HRV, stress, emotions, ECG, plus all GENERIC_* / HEART_* / weight / glucose
fallback tables. The reference Gadgetbridge sources are at
`https://codeberg.org/Freeyourgadget/Gadgetbridge/src/branch/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/`.

---

## 1. Population overview

Re-counted at investigation time (the task brief's row counts were stale — actual data is
substantially larger):

| Table                       | Rows | Status   |
|-----------------------------|------|----------|
| HUAWEI_TEMPERATURE_SAMPLE   |  904 | populated |
| HUAWEI_HRV_VALUE_SAMPLE     |   62 | populated |
| HUAWEI_STRESS_SAMPLE        |   29 | populated (brief said empty — it is not) |
| HUAWEI_EMOTIONS_SAMPLE      |    0 | empty    |
| HUAWEI_ECG_DATA_SAMPLE      |    0 | empty    |
| HUAWEI_ECG_SUMMARY_SAMPLE   |    0 | empty    |
| GENERIC_HEART_RATE_SAMPLE   |    0 | empty    |
| GENERIC_HRV_VALUE_SAMPLE    |    0 | empty    |
| GENERIC_STRESS_SAMPLE       |    0 | empty    |
| GENERIC_TEMPERATURE_SAMPLE  |    0 | empty    |
| GENERIC_SPO2_SAMPLE         |    0 | empty    |
| GENERIC_BLOOD_PRESSURE_SAMPLE |  0 | empty    |
| GENERIC_WEIGHT_SAMPLE       |    0 | empty    |
| GENERIC_TRAINING_LOAD_ACUTE_SAMPLE   | 0 | empty |
| GENERIC_TRAINING_LOAD_CHRONIC_SAMPLE | 0 | empty |
| GENERIC_SLEEP_STAGE_SAMPLE  |    0 | empty    |
| HEART_RR_INTERVAL_SAMPLE    |    0 | empty    |
| HEART_PULSE_SAMPLE          |    0 | empty    |
| MI_SCALE_WEIGHT_SAMPLE      |    0 | empty    |
| GLUCOSE_SAMPLE              |    0 | empty    |

All non-Huawei biometric tables in this DB are empty, as expected for a Huawei-only
deployment. Huawei's coordinator routes everything through HUAWEI_* tables; the GENERIC_*
tables are vendor-neutral fallbacks used by other coordinators (e.g. some Bluetooth-LE
spec devices, third-party providers).

For the full populated-table list across the whole DB (only biometric/sleep/activity rows
have any data), see Section 9.

---

## 2. HUAWEI_TEMPERATURE_SAMPLE — skin temperature, 904 rows

### Schema

```sql
CREATE TABLE HUAWEI_TEMPERATURE_SAMPLE (
  TIMESTAMP             INTEGER NOT NULL,   -- ms epoch (UTC), measurement time
  DEVICE_ID             INTEGER NOT NULL,   -- FK -> DEVICE._id (= 1)
  USER_ID               INTEGER NOT NULL,   -- FK -> USER._id (= 1)
  LAST_TIMESTAMP        INTEGER NOT NULL,   -- watermark for incremental sync (HuaweiTemperatureSampleProvider.getLastFetchTimestamp)
  TEMPERATURE           REAL    NOT NULL,   -- degrees Celsius (float32 precision artifacts visible)
  TEMPERATURE_TYPE      INTEGER NOT NULL,   -- TemperatureSample.TYPE_* — always 2 = TYPE_SKIN
  TEMPERATURE_LOCATION  INTEGER NOT NULL,   -- TemperatureSample.LOCATION_* — always 9 = LOCATION_WRIST
  PRIMARY KEY (TIMESTAMP, DEVICE_ID, TEMPERATURE_TYPE)
) WITHOUT ROWID;
CREATE INDEX IDX_HUAWEI_TEMPERATURE_SAMPLE_LAST_TIMESTAMP
  ON HUAWEI_TEMPERATURE_SAMPLE (LAST_TIMESTAMP);
```

### Type/location encoding

From `model/TemperatureSample.java`:

| Value | Constant            | Meaning      |
|-------|---------------------|--------------|
| TYPE_TEMPERATURE = 2     | `TYPE_SKIN`         | not body, not ambient |
| LOCATION = 9    | `LOCATION_WRIST`    | wrist sensor          |

In `HuaweiTemperatureSampleProvider.createSample()` Gadgetbridge hard-codes:

```java
sample.setTemperatureType(TemperatureSample.TYPE_SKIN);
sample.setTemperatureLocation(TemperatureSample.LOCATION_WRIST);
```

So every row in this DB is **wrist skin temperature in °C**, never body/core temperature.
The watch is *not* doing fever-detection-grade body-temperature measurement; this is the
ambient skin reading the GT 5 Pro takes during continuous monitoring.

### Source dictionary key

The Huawei protocol delivers these via the dictionary subsystem. From
`devices/huawei/HuaweiDictTypes.java`:

```java
public static final int SKIN_TEMPERATURE_CLASS = 400012;
public static final int SKIN_TEMPERATURE_VALUE = 400012430;
```

So dict-class **400012** is the watch-side identifier for skin-temperature payloads. Rows
land in `HUAWEI_TEMPERATURE_SAMPLE` (not in the dict tables, which are empty here).

### Distribution

- Rows: 904
- Time span: 2024-06-15 19:41:00 → 2024-06-16 11:35:00 (local) — 15 h 54 min
- Sample interval: 60 s exactly (TIMESTAMPs increment by 60 000 ms; matches Huawei's
  continuous skin-temperature cadence)
- TEMPERATURE_TYPE: only `2` (TYPE_SKIN)
- TEMPERATURE_LOCATION: only `9` (LOCATION_WRIST)
- TEMPERATURE range: **30.6 – 35.5 °C**, mean 33.74 °C
- The values float32-encode then re-emerge as REAL with float artifacts
  (e.g. `34.2999992370605` = 34.3, `34.7000007629395` = 34.7).

### Behavioural pattern

A typical wrist-skin diurnal curve is visible:

| Local time   | Approx. temp | Note                                  |
|--------------|--------------|---------------------------------------|
| 19:41 (start)| 34.3 °C      | evening, watch warming up on wrist    |
| 19:55-20:00  | 35.0–35.1 °C | hottest stretch of evening            |
| 02-05 a.m.   | 32–34 °C     | sleep, lower wrist temp               |
| 11:35 (end)  | 31.8 °C      | watch likely just put on / off-wrist  |

The dip at the end (~31.8 °C) and the dip near the very start (30.6 °C minimum) are
consistent with the watch being briefly off-wrist or loosened — wrist-skin temp is highly
sensitive to contact and ambient air.

### Sample rows (first 5, last 5)

```
TIMESTAMP        local_dt              TEMP_C   TYPE LOC
1778002860000    2024-06-15 19:41:00   34.30    2    9
1778002920000    2024-06-15 19:42:00   34.50    2    9
1778002980000    2024-06-15 19:43:00   34.50    2    9
1778003040000    2024-06-15 19:44:00   34.50    2    9
1778003100000    2024-06-15 19:45:00   34.50    2    9
...
1778059920000    2024-06-16 11:32:00   31.40    2    9
1778059980000    2024-06-16 11:33:00   31.70    2    9
1778060040000    2024-06-16 11:34:00   31.80    2    9
1778060100000    2024-06-16 11:35:00   31.80    2    9
```

(Full dump is 904 rows — query
`SELECT TIMESTAMP, datetime(TIMESTAMP/1000,'unixepoch','localtime'), TEMPERATURE FROM HUAWEI_TEMPERATURE_SAMPLE ORDER BY TIMESTAMP;`.)

---

## 3. HUAWEI_HRV_VALUE_SAMPLE — heart-rate variability, 62 rows

### Schema

```sql
CREATE TABLE HUAWEI_HRV_VALUE_SAMPLE (
  TIMESTAMP       INTEGER NOT NULL,   -- ms epoch
  DEVICE_ID       INTEGER NOT NULL,
  USER_ID         INTEGER NOT NULL,
  LAST_TIMESTAMP  INTEGER NOT NULL,   -- sync watermark
  VALUE           INTEGER NOT NULL,   -- HRV in ms (per HrvValueSample.java)
  PRIMARY KEY (TIMESTAMP, DEVICE_ID)
) WITHOUT ROWID;
```

### Unit interpretation

From `model/HrvValueSample.java`:

```java
public interface HrvValueSample extends TimeSample {
    /** HRV value, in milliseconds. */
    int getValue();
}
```

So `VALUE` is documented to be **HRV in milliseconds**. Whether the watch actually emits
RMSSD, SDNN, or some Huawei-proprietary "HRV index" is not exposed by Gadgetbridge — the
provider stores the raw int that Huawei sent. Numerical range and shape strongly suggest
**RMSSD-like ms HRV**:

- 62 samples over 13 h 39 min (≈ one every 13 min — irregular, not a fixed cadence)
- Range **9 – 118 ms**, mean **61.16 ms**
- Bucketed: 8 samples ≤ 29, 21 in 30-59, 17 in 60-79, 12 in 80-100, 4 > 100.

These numbers (9-118 ms, mean ~61) are perfectly consistent with night-time RMSSD figures
for a healthy adult; daytime/active periods drop into the teens, deep-sleep peaks reach
into 80-118 ms. They are *not* consistent with SDNN of a 24h ECG (typically 50-200 ms but
on a different scale) nor with a unitless "HRV index" 0-100. **Best interpretation: RMSSD
(or close equivalent) in ms.** Gadgetbridge itself just labels it "HRV ms".

### Sample rows

```
TIMESTAMP        local_dt              VALUE_ms
1778003556000    2024-06-15 19:52:36   42
1778004754000    2024-06-15 20:12:34   71
1778005715000    2024-06-15 20:28:35   56
1778005895000    2024-06-15 20:31:35   68
1778007215000    2024-06-15 20:53:35   60
...                                    ...
1778049692000    2024-06-16 08:41:32   74
1778050292000    2024-06-16 08:51:32   59
1778051492000    2024-06-16 09:11:32   107
1778052093000    2024-06-16 09:21:33   85
1778052693000    2024-06-16 09:31:33   66
```

### Cross-check vs sleep_stats HRV baseline

`HUAWEI_SLEEP_STATS_SAMPLE` (1 row, sleep night 2024-06-15 → 2024-06-16) reports:

- `AVG_HRV` = **70 ms**
- `HRV_DAY_TO_BASELINE` = 6
- `MAX_HRV_BASELINE` / `MIN_HRV_BASELINE` = -1 (not yet learned, only ~one night of data)

70 ms aligns with the mean of HRV values that fall during the sleep window in this table —
adds confidence that `VALUE` is in **ms**.

---

## 4. HUAWEI_STRESS_SAMPLE — stress index, 29 rows (NOT empty)

The task brief said this table was empty; it is not. The watch *is* recording stress and
Gadgetbridge *does* support it for the GT 5 Pro.

### Schema

```sql
CREATE TABLE HUAWEI_STRESS_SAMPLE (
  TIMESTAMP   INTEGER NOT NULL,   -- ms epoch (end of measurement window)
  DEVICE_ID   INTEGER NOT NULL,
  USER_ID     INTEGER NOT NULL,
  STRESS      INTEGER NOT NULL,   -- 0-100 stress score
  LEVEL       INTEGER NOT NULL,   -- bucketed level (1=relaxed, 2=mild, 3=moderate, 4=high)
  START_TIME  INTEGER NOT NULL,   -- ms epoch, beginning of measurement window
  PRIMARY KEY (TIMESTAMP, DEVICE_ID)
) WITHOUT ROWID;
```

Note: this table has **no `LAST_TIMESTAMP`** (unlike temperature / HRV / emotions). Sync
state is presumably tracked elsewhere or not needed because the rows themselves carry
START_TIME and TIMESTAMP that delimit each measurement window.

### Stress / Level encoding

From `HuaweiCoordinator.getStressRanges()`:

```java
// 1-29  = relaxed
// 30-59 = mild
// 60-79 = moderate
// 80-100 = high
return new int[]{1, 30, 60, 80};
```

The `LEVEL` column in this DB only contains `1`, `2`, `3` (no `4`). Cross-tabulating with
`STRESS`:

| LEVEL | n  | STRESS min | STRESS max | Bucket meaning             |
|-------|----|------------|------------|----------------------------|
|   1   |  9 |  15        | 29         | relaxed (per coordinator)  |
|   2   | 16 | 30         | 55         | mild                       |
|   3   |  4 | 60         | 63         | moderate                   |
|   4   |  0 | —          | —          | high (none recorded)       |

Encoding clearly matches: `LEVEL` is the bucket index aligned with `getStressRanges()`,
and `STRESS` is the underlying 0-100 score.

There is also a separate `StressSample.Type` enum in `model/StressSample.java` (MANUAL=0,
AUTOMATIC=1, UNKNOWN=2) — but the Huawei provider does not write it into a column here;
LEVEL in this table is the bucket, not the measurement type.

### Distribution

- Rows: 29
- Time span: 2024-06-15 20:08:35 → 2024-06-16 11:08:35 (≈ 15 h)
- Cadence: ~30 min between samples (consistent with Huawei's auto-stress sampling
  cadence; the comment in HuaweiCoordinator says "stress data is provided every 30
  minutes"; observed gaps are 18-37 min).
- STRESS: range 15-63, mean 39.0 → user spent the entire window between **relaxed and
  moderate**, never high.
- START_TIME is consistently TIMESTAMP minus 55-56 s — so each row represents an ~1 min
  measurement window ending at TIMESTAMP.

### Sample rows

```
TIMESTAMP        local_dt              STRESS LEVEL START_TIME (local)
1778004515000    2024-06-15 20:08:35     52    2   2024-06-15 20:07:39
1778005895000    2024-06-15 20:31:35     41    2   2024-06-15 20:30:39
1778007695000    2024-06-15 21:01:35     39    2   2024-06-15 21:00:39
1778011355000    2024-06-15 22:02:35     63    3   2024-06-15 22:01:39   <- moderate
1778027493000    2024-06-16 02:31:33     29    1   2024-06-16 02:30:38   <- relaxed (sleep)
1778034692000    2024-06-16 04:31:32     15    1   2024-06-16 04:30:36   <- relaxed (sleep)
1778047292000    2024-06-16 08:01:32     15    1   2024-06-16 08:00:37   <- relaxed (still sleep / waking)
1778058515000    2024-06-16 11:08:35     47    2   2024-06-16 11:07:39
```

### Why the brief said "empty"

The brief is wrong on stress. Possible causes:

1. The brief was written from an older snapshot where the toggle in the device-specific
   stress settings (`xml/devicesettings_huawei_stress.xml`,
   `pref_huawei_stress_switch`) was off — then later turned on.
2. Or the brief simply used `SELECT ... LIMIT 1` style at a moment when sync hadn't
   fetched stress yet. The data is now present.

Gadgetbridge fully supports automatic stress for the GT 5 Pro — capability gating in
`HuaweiCoordinator.supportsStressMeasurement()` calls
`HuaweiDeviceStateManager.get(device).supportsAutoStress()`, which the GT 5 Pro
satisfies (evidence: stress data is here). The user simply needs to keep the watch's
auto-stress toggle on.

### Cross-reference with HUAWEI_SLEEP_STATS_SAMPLE

`HUAWEI_SLEEP_STATS_SAMPLE` does *not* contain a stress column. It contains
HRV/breath-rate/SpO2/HR baselines only (see Section 3). So sleep-stats is not a
substitute for HUAWEI_STRESS_SAMPLE; they're independent. The brief's worry "why is
stress empty when sleep_stats has stress-relevant data" was based on the stale
empty-stress observation; in reality both tables are populated and store different
things.

---

## 5. HUAWEI_EMOTIONS_SAMPLE — empty (0 rows)

### Schema

```sql
CREATE TABLE HUAWEI_EMOTIONS_SAMPLE (
  TIMESTAMP           INTEGER NOT NULL,
  DEVICE_ID           INTEGER NOT NULL,
  USER_ID             INTEGER NOT NULL,
  LAST_TIMESTAMP      INTEGER NOT NULL,
  STATUS              INTEGER NOT NULL,   -- emotion classification (Huawei dict-encoded)
  VALENCE_CHARACTER   REAL,               -- valence axis (positive vs negative)
  ORIGIN_STATUS       INTEGER,            -- pre-mapping raw status
  AROUSAL_CHARACTER   REAL,               -- arousal axis (calm vs energised)
  PRIMARY KEY (TIMESTAMP, DEVICE_ID)
) WITHOUT ROWID;
```

### Why empty

Emotion sensing is a Huawei-Health–only feature on most GT-series watches. Gadgetbridge
has `HuaweiEmotionsSampleProvider` and a delete hook in HuaweiCoordinator, but the
GT 5 Pro either (a) does not stream emotions over the open BLE protocol Gadgetbridge
talks to, or (b) requires an explicit setting that isn't enabled here. Empty is expected.

If/when Gadgetbridge starts ingesting emotions for this device, rows would land here with
the watch's classification (`STATUS`) plus the 2D valence/arousal mood-circumplex
floats.

---

## 6. HUAWEI_ECG_DATA_SAMPLE / HUAWEI_ECG_SUMMARY_SAMPLE — empty

### Schemas

```sql
CREATE TABLE HUAWEI_ECG_SUMMARY_SAMPLE (
  ECG_ID              INTEGER PRIMARY KEY AUTOINCREMENT,
  DEVICE_ID           INTEGER NOT NULL,
  USER_ID             INTEGER NOT NULL,
  START_TIMESTAMP     INTEGER NOT NULL,
  END_TIMESTAMP       INTEGER NOT NULL,
  APP_VERSION         TEXT    NOT NULL,
  AVERAGE_HEART_RATE  INTEGER NOT NULL,
  ARRHYTHMIA_TYPE     INTEGER NOT NULL,   -- HuaweiDictTypes.ARRHYTHMIA_CLASS = 700004
  USER_SYMPTOMS       INTEGER NOT NULL
);
CREATE INDEX IDX_HUAWEI_ECG_SUMMARY_SAMPLE_START_TIMESTAMP ...;
CREATE INDEX IDX_HUAWEI_ECG_SUMMARY_SAMPLE_END_TIMESTAMP ...;
CREATE INDEX IDX_HUAWEI_ECG_SUMMARY_SAMPLE_ARRHYTHMIA_TYPE ...;

CREATE TABLE HUAWEI_ECG_DATA_SAMPLE (
  ECG_ID      INTEGER NOT NULL,   -- FK to HUAWEI_ECG_SUMMARY_SAMPLE.ECG_ID
  TIME_DELTA  INTEGER NOT NULL,   -- offset within the recording (ms or samples)
  VALUE       REAL    NOT NULL,   -- ECG amplitude
  PRIMARY KEY (ECG_ID, TIME_DELTA)
) WITHOUT ROWID;
```

### Why empty

ECG on Huawei watches is a manual user-initiated recording; the GT 5 Pro does support
ECG hardware-wise but in many regions the feature is region-locked. The relevant
`devicesettings_huawei_ecg.xml` is gated by
`deviceState.supportsECG() && deviceState.isShowForceCountrySpecificFeatures(device)`
in `HuaweiCoordinator`. The user has not run any ECG measurement during the captured
window. Empty is expected.

---

## 7. Generic / fallback tables — all empty (verified)

These are vendor-neutral biometric tables used only by *non-Huawei* coordinators or by
Bluetooth-LE-spec generic providers. For a Huawei-only setup they will always be empty.

| Table                                | Schema columns (besides TIMESTAMP, DEVICE_ID, USER_ID PK) | Where it would store data |
|--------------------------------------|------------------------------------------------------------|---------------------------|
| `GENERIC_HEART_RATE_SAMPLE`          | `HEART_RATE INTEGER`                                       | Generic BLE Heart Rate Service (0x180D) — not used by Huawei coordinator (which uses `HUAWEI_ACTIVITY_SAMPLE.HEART_RATE`). |
| `GENERIC_HRV_VALUE_SAMPLE`           | `VALUE INTEGER` (ms)                                       | Coordinators that don't have a vendor HRV table. Huawei uses `HUAWEI_HRV_VALUE_SAMPLE`. |
| `GENERIC_STRESS_SAMPLE`              | `STRESS INTEGER` (0-100)                                   | Generic stress fallback. Huawei uses `HUAWEI_STRESS_SAMPLE`. |
| `GENERIC_TEMPERATURE_SAMPLE`         | `TEMPERATURE REAL, TEMPERATURE_TYPE INT, TEMPERATURE_LOCATION INT` | Generic temp fallback. Huawei uses `HUAWEI_TEMPERATURE_SAMPLE`. |
| `GENERIC_SPO2_SAMPLE`                | `SPO2 INTEGER`                                             | Generic SpO2 fallback. Huawei rolls SpO2 into `HUAWEI_ACTIVITY_SAMPLE.SPO2` and `HUAWEI_WORKOUT_SP_O2_SAMPLE`. |
| `GENERIC_BLOOD_PRESSURE_SAMPLE`      | `BP_SYSTOLIC, BP_DIASTOLIC, USER_INDEX, MEAN_ARTERIAL_PRESSURE, PULSE_RATE, MEASUREMENT_STATUS` | Generic BLE Blood Pressure profile (0x1810). The GT 5 Pro does not measure BP — empty regardless. |
| `GENERIC_WEIGHT_SAMPLE`              | `WEIGHT_KG REAL`                                           | Generic BLE Weight Scale profile (0x181D). The GT 5 Pro is not a scale. |
| `GENERIC_TRAINING_LOAD_ACUTE_SAMPLE` | `VALUE INTEGER`                                            | Used by Garmin / others for ATL. Huawei does not export training-load values to Gadgetbridge. |
| `GENERIC_TRAINING_LOAD_CHRONIC_SAMPLE` | `VALUE INTEGER`                                          | Same as above for CTL. |
| `GENERIC_SLEEP_STAGE_SAMPLE`         | (sleep stage value)                                        | Generic sleep-stage fallback. Huawei uses `HUAWEI_SLEEP_STAGE_SAMPLE`. |
| `HEART_RR_INTERVAL_SAMPLE`           | `SEQ INTEGER, RR_MILLIS INTEGER`                           | RR-interval beat-to-beat data from BLE HR service. Huawei does not stream RR-intervals to Gadgetbridge. |
| `HEART_PULSE_SAMPLE`                 | (no extra columns — pulse-event marker)                    | Generic pulse-event fallback. Unused by the Huawei coordinator. |
| `MI_SCALE_WEIGHT_SAMPLE`             | `WEIGHT_KG REAL`                                           | Xiaomi Mi Smart Scale only. Irrelevant; empty. |
| `GLUCOSE_SAMPLE`                     | `VALUE_MG_DL REAL`                                         | Generic glucose monitor (BLE 0x1808). Irrelevant; empty. |

All confirmed empty by direct count.

---

## 8. Summary of the watch's biometrics that *are* tracked vs not

| Domain                        | Storage                                  | Status here |
|-------------------------------|------------------------------------------|-------------|
| Heart rate (continuous + workout) | `HUAWEI_ACTIVITY_SAMPLE.HEART_RATE` (1944 rows) | Captured (in activity table, see doc 02/04) |
| Skin temperature              | `HUAWEI_TEMPERATURE_SAMPLE`              | **904 rows, captured** |
| HRV (RMSSD-like, ms)          | `HUAWEI_HRV_VALUE_SAMPLE`                | **62 rows, captured** |
| Stress (0-100 + bucket)       | `HUAWEI_STRESS_SAMPLE`                   | **29 rows, captured** |
| HRV / SpO2 / breath / HR baselines (per night) | `HUAWEI_SLEEP_STATS_SAMPLE` | 1 row, captured (see doc on sleep) |
| Sleep apnea events (per night)| `HUAWEI_SLEEP_APNEA_SAMPLE`              | 2 rows, captured |
| Emotions / mood circumplex    | `HUAWEI_EMOTIONS_SAMPLE`                 | empty (likely not exported by watch over BLE) |
| ECG single-lead recording     | `HUAWEI_ECG_*`                           | empty (no manual ECG taken) |
| Body / core temperature       | n/a                                      | watch only does skin |
| Blood pressure                | n/a (`GENERIC_BLOOD_PRESSURE_SAMPLE` empty) | not measured |
| Glucose                       | n/a (`GLUCOSE_SAMPLE` empty)             | not measured |
| Body weight                   | n/a (`GENERIC_WEIGHT_SAMPLE`, `MI_SCALE_WEIGHT_SAMPLE` empty) | no scale paired |
| RR-intervals (beat-to-beat)   | n/a (`HEART_RR_INTERVAL_SAMPLE` empty)   | not exported |
| Training load (ATL/CTL)       | n/a (`GENERIC_TRAINING_LOAD_*_SAMPLE` empty) | Huawei does not export |

---

## 9. All populated tables in the database (whole DB context)

For completeness — every non-empty table in `Gadgetbridge.db`:

```
ALARM                          6
BATTERY_LEVEL                 20
CALENDAR_SYNC_STATE            9
DEVICE                         1
DEVICE_ATTRIBUTES              1
HUAWEI_ACTIVITY_SAMPLE      1944
HUAWEI_HRV_VALUE_SAMPLE       62
HUAWEI_SLEEP_APNEA_SAMPLE      2
HUAWEI_SLEEP_STAGE_SAMPLE    524
HUAWEI_SLEEP_STATS_SAMPLE      1
HUAWEI_STRESS_SAMPLE          29
HUAWEI_TEMPERATURE_SAMPLE    904
USER                           1
USER_ATTRIBUTES                2
```

Every other table in the DB is empty. Nothing in HUAWEI_DICT_DATA / HUAWEI_DICT_DATA_VALUES
(Gadgetbridge decodes the dict payloads inline and writes to the typed tables; the dict
tables only hold un-recognised classes, of which there are currently zero for this user).

---

## 10. Useful queries

```sql
-- Skin-temp time-series (CSV-ready)
SELECT datetime(TIMESTAMP/1000,'unixepoch','localtime') AS local_dt, TEMPERATURE
FROM HUAWEI_TEMPERATURE_SAMPLE
ORDER BY TIMESTAMP;

-- HRV time-series with sleep / wake context (manual join via sleep_stats window)
SELECT datetime(h.TIMESTAMP/1000,'unixepoch','localtime') AS local_dt,
       h.VALUE AS hrv_ms,
       CASE WHEN h.TIMESTAMP BETWEEN s.BED_TIME AND s.RISING_TIME
            THEN 'sleep' ELSE 'wake' END AS phase
FROM HUAWEI_HRV_VALUE_SAMPLE h
LEFT JOIN HUAWEI_SLEEP_STATS_SAMPLE s
  ON h.DEVICE_ID = s.DEVICE_ID
ORDER BY h.TIMESTAMP;

-- Stress with bucket label
SELECT datetime(TIMESTAMP/1000,'unixepoch','localtime') AS local_dt,
       STRESS,
       CASE LEVEL WHEN 1 THEN 'relaxed' WHEN 2 THEN 'mild'
                   WHEN 3 THEN 'moderate' WHEN 4 THEN 'high'
                   ELSE 'unknown' END AS bucket
FROM HUAWEI_STRESS_SAMPLE
ORDER BY TIMESTAMP;
```

---

## 11. Caveats

- Float artifacts in `TEMPERATURE`: read as `ROUND(TEMPERATURE,1)` for display.
- The brief's row counts (TEMP=14, HRV=1, STRESS=0) were stale; the present DB has 904 /
  62 / 29 respectively. Make sure to re-count before quoting.
- Only one sleep night is in the DB, so `HUAWEI_SLEEP_STATS_SAMPLE` baselines
  (`MIN_HRV_BASELINE`, `MAX_HRV_BASELINE`, etc.) are still `-1` (unlearned).
- The HRV unit ("milliseconds") is what Gadgetbridge claims; Huawei's exact algorithm
  (RMSSD vs SDNN vs proprietary) is not documented, but the magnitudes match RMSSD.
- `LAST_TIMESTAMP` columns track sync-cursor state, not a sample's "end time"; for stress
  the analogous concept is `START_TIME` ↔ `TIMESTAMP`.
