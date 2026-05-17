# Workouts, Dict Data, ECG and VO2Max Domain

> **Note:** All concrete sample values and timestamps below come from a single illustrative capture window. The *structural* claims (table layout, empty-vs-populated, VO2Max location) are the load-bearing content.


Database: `Gadgetbridge.db`
Device: HUAWEI WATCH GT 5 Pro (`XX:XX:XX:XX:XX:XX`)

This document covers all Huawei workout-related tables, the catch-all `HUAWEI_DICT_DATA` streams (where VO2Max and other secondary metrics live), the ECG tables, and the generic `BASE_ACTIVITY_SUMMARY` / `ACTIVITY_DESCRIPTION` / `TAG` tables.

Source reference: [Gadgetbridge Huawei device package](https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/branch/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/) and the entity definitions emitted by `GBDaoGenerator`.

---

## 1. State Summary (this database)

Every workout-related table in this database is **empty**. Workout sync on Huawei devices is a manual on-demand operation in Gadgetbridge (the user must press "Fetch Workouts" or "Fetch Activity Data" in the device card menu); it is not part of automatic background sync. Thus, *no workouts have ever been transferred from the watch to this database*.

| Table | Rows |
|---|---|
| `HUAWEI_WORKOUT_SUMMARY_SAMPLE` | 0 |
| `HUAWEI_WORKOUT_DATA_SAMPLE` | 0 |
| `HUAWEI_WORKOUT_PACE_SAMPLE` | 0 |
| `HUAWEI_WORKOUT_SECTIONS_SAMPLE` | 0 |
| `HUAWEI_WORKOUT_SP_O2_SAMPLE` | 0 |
| `HUAWEI_WORKOUT_SUMMARY_ADDITIONAL_VALUES_SAMPLE` | 0 |
| `HUAWEI_WORKOUT_SWIM_SEGMENTS_SAMPLE` | 0 |
| `BASE_ACTIVITY_SUMMARY` | 0 |
| `ACTIVITY_DESCRIPTION` | 0 |
| `ACTIVITY_DESC_TAG_LINK` | 0 |
| `TAG` | 0 |
| `HUAWEI_DICT_DATA` | 0 |
| `HUAWEI_DICT_DATA_VALUES` | 0 |
| `HUAWEI_ECG_SUMMARY_SAMPLE` | 0 |
| `HUAWEI_ECG_DATA_SAMPLE` | 0 |

Implication: **there is no VO2Max data in this database**. See section 4 for where it would live if a workout had been synced.

---

## 2. `HUAWEI_WORKOUT_SUMMARY_SAMPLE` — per-workout header

Entity: `HuaweiWorkoutSummarySample`. One row per workout, identified by autoincrement `WORKOUT_ID`.

| Column | Type | Meaning |
|---|---|---|
| `WORKOUT_ID` | INTEGER PK AI | Local primary key, foreign-keyed by all child tables |
| `DEVICE_ID` | INTEGER | FK to `DEVICE._id` |
| `USER_ID` | INTEGER | FK to `USER._id` |
| `WORKOUT_NUMBER` | INTEGER | Watch-side workout sequence id |
| `STATUS` | INTEGER | Sync/parse status flag |
| `START_TIMESTAMP` | INTEGER | Workout start (Huawei epoch seconds — usually Unix seconds) |
| `END_TIMESTAMP` | INTEGER | Workout end |
| `CALORIES` | INTEGER | Total kcal |
| `DISTANCE` | INTEGER | Distance, metres |
| `STEP_COUNT` | INTEGER | Steps recorded during the workout |
| `TOTAL_TIME` | INTEGER | Wall-clock duration |
| `DURATION` | INTEGER | Active duration (excludes pauses) |
| `TYPE` | INTEGER | Activity kind (Huawei workout type code; mapped via `HuaweiWorkoutGbParser.huaweiTypeToGbType`) |
| `STROKES` | INTEGER | Swim total strokes |
| `AVG_STROKE_RATE` | INTEGER | Swim avg strokes/min |
| `POOL_LENGTH` | INTEGER | Configured pool length, metres |
| `LAPS` | INTEGER | Swim laps |
| `AVG_SWOLF` | INTEGER | Average SWOLF score |
| `RAW_DATA` | BLOB | Original packet payload (kept verbatim for reparse) |
| `GPX_FILE_LOCATION` | TEXT | Path on device storage to generated GPX |
| `MAX_ALTITUDE` / `MIN_ALTITUDE` | INTEGER | Altitude extremes, metres |
| `ELEVATION_GAIN` / `ELEVATION_LOSS` | INTEGER | Cumulative ascent/descent, metres |
| `WORKOUT_LOAD` | INTEGER | Huawei "training load" score |
| `WORKOUT_AEROBIC_EFFECT` | INTEGER | EPOC-style aerobic effect (×10, range 0–50) |
| `WORKOUT_ANAEROBIC_EFFECT` | INTEGER | Anaerobic effect (×10) |
| `RECOVERY_TIME` | INTEGER | Hours of suggested recovery |
| `MIN_HEART_RATE_PEAK` / `MAX_HEART_RATE_PEAK` | INTEGER | HR extremes |
| `RECOVERY_HEART_RATES` | BLOB | Post-workout HR drop curve, packed |
| `SWIM_TYPE` | INTEGER | Pool/open-water |
| `MAX_MET` | INTEGER | Peak metabolic equivalent reached (×10). **Closely related to VO2Max** but distinct |
| `HR_ZONE_TYPE` | INTEGER | Which zone model (max-HR / reserve / LTHR) |
| `RUN_PACE_ZONE1_MIN` … `RUN_PACE_ZONE5_MAX` | INTEGER | User-defined pace zone boundaries (sec/km) |
| `RUN_PACE_ZONE1_TIME` … `RUN_PACE_ZONE5_TIME` | INTEGER | Time spent in each pace zone |
| `ALG_TYPE` | INTEGER | Watch firmware algorithm version flag |
| `TRAINING_POINTS` | INTEGER | Huawei TrainingPoints score |
| `LONGEST_STREAK` | INTEGER | Longest stride/jump streak (sport-specific) |
| `TRIPPED` | INTEGER | Trip detection flag |
| `NEW_STEPS` | INTEGER | Steps post-correction |

---

## 3. `HUAWEI_WORKOUT_DATA_SAMPLE` — per-second / sub-second timeseries

Entity: `HuaweiWorkoutDataSample`. Composite PK `(WORKOUT_ID, TIMESTAMP)`. One row per recorded sample inside a workout.

| Column | Meaning |
|---|---|
| `WORKOUT_ID` | FK to summary |
| `TIMESTAMP` | Sample time (Unix seconds) |
| `HEART_RATE` | bpm |
| `SPEED` | dm/s or m/s ×10 (sport-dependent) |
| `STEP_RATE` | spm |
| `CADENCE` | rpm |
| `STEP_LENGTH` | cm |
| `GROUND_CONTACT_TIME` | ms |
| `IMPACT` | g, ×10 |
| `SWING_ANGLE` | degrees |
| `FORE_FOOT_LANDING`, `MID_FOOT_LANDING`, `BACK_FOOT_LANDING` | Landing-zone counters |
| `EVERSION_ANGLE` | Pronation/supination angle |
| `SWOLF` | Per-lap SWOLF |
| `STROKE_RATE` | Swim stroke rate |
| `DATA_ERROR_HEX` | BLOB; raw error/diagnostic flags |
| `CALORIES` | Cumulative kcal at sample time |
| `CYCLING_POWER` | Watts |
| `FREQUENCY` | Cycling cadence (rpm) — separate from stride cadence |
| `ALTITUDE` | metres |
| `HANG_TIME` | ms (running airborne time) |
| `IMPACT_HANG_RATE` | Ratio (×100) |
| `RIDE_CADENCE` | Bike rpm |
| `AP` | REAL — air pressure / running power proxy |
| `VO` | REAL — vertical oscillation, cm |
| `GTB` | REAL — ground time balance L/R % |
| `VR` | REAL — vertical ratio (osc/stride length) |
| `CEILING` | Diving ceiling depth, m |
| `TEMP` | Water/skin temp ×10 °C |
| `SPO2` | % |
| `CNS` | Diving central-nervous-system O2 toxicity load |

Note: `WITHOUT ROWID` — the table is keyed directly by `(WORKOUT_ID, TIMESTAMP)`.

---

## 4. `HUAWEI_WORKOUT_SUMMARY_ADDITIONAL_VALUES_SAMPLE` — *VO2Max lives here*

Entity: `HuaweiWorkoutSummaryAdditionalValuesSample`. PK `(WORKOUT_ID, KEY)`.

| Column | Meaning |
|---|---|
| `WORKOUT_ID` | FK to summary |
| `KEY` | TEXT — metric name |
| `VALUE` | TEXT — stringified value |

This is a key/value side-car attached to each workout for any field Huawei adds in newer firmware that is not part of the fixed-schema summary table. Observed keys in the wild include:

- `vo2max` — running VO2Max estimate (mL·kg⁻¹·min⁻¹). **Primary VO2Max storage**
- `runEffectScore`
- `runningCourseLoad`
- `restHeartRate`
- `lactateThreshold`
- `runningPosture` aggregates
- `pulseSpO2Result` etc.

**VO2Max is reported by the watch only at the end of a *running* workout** (and a few aerobic types). Without any synced workout, no VO2Max value can possibly exist. Gadgetbridge does not maintain a separate VO2Max sample table for Huawei — the value is workout-attached.

A secondary route: some newer firmware streams a daily VO2Max trend through `HUAWEI_DICT_DATA` (see section 8). In neither location is data present here.

---

## 5. `HUAWEI_WORKOUT_PACE_SAMPLE`

Entity: `HuaweiWorkoutPaceSample`. PK `(WORKOUT_ID, PACE_INDEX, DISTANCE, TYPE)`.

Per-kilometre / per-mile / lap pace splits.

| Column | Meaning |
|---|---|
| `WORKOUT_ID` | FK |
| `PACE_INDEX` | Sequence number of the split |
| `DISTANCE` | Cumulative metres at split end |
| `TYPE` | Split type code (1 km, 1 mile, lap, manual) |
| `PACE` | Seconds for this split |
| `POINT_INDEX` | Index in the linked GPS/track-point list |
| `CORRECTION` | Optional pace correction flag |

---

## 6. `HUAWEI_WORKOUT_SECTIONS_SAMPLE`

Entity: `HuaweiWorkoutSectionsSample`. PK `(WORKOUT_ID, DATA_IDX, ROW_IDX)`.

Section-by-section aggregates, e.g. interval blocks, dive segments.

| Column | Meaning |
|---|---|
| `DATA_IDX` | Section group id |
| `ROW_IDX` | Row inside section |
| `NUM` | Reps within set |
| `TIME` | Section duration s |
| `DISTANCE` | metres |
| `PACE` | s/km |
| `HEART_RATE`, `CADENCE`, `STEP_LENGTH` | Section averages |
| `TOTAL_RISE` / `TOTAL_DESCEND` | metres |
| `GROUND_CONTACT_TIME`, `GROUND_IMPACT`, `SWING_ANGLE`, `EVERSION` | Running-form averages |
| `AVG_CADENCE` | rpm |
| `INTERVAL_TRAINING_TYPE` | Work / rest / warmup / cooldown |
| `DIVING_MAX_DEPTH` | metres |
| `DIVING_UNDERWATER_TIME` / `DIVING_BREAK_TIME` | seconds |

---

## 7. `HUAWEI_WORKOUT_SP_O2_SAMPLE` and `HUAWEI_WORKOUT_SWIM_SEGMENTS_SAMPLE`

`HUAWEI_WORKOUT_SP_O2_SAMPLE` (PK `(WORKOUT_ID, INTERVAL)`):
- `INTERVAL` — sample number within the workout
- `VALUE` — SpO₂ %

`HUAWEI_WORKOUT_SWIM_SEGMENTS_SAMPLE` (PK `(WORKOUT_ID, SEGMENT_INDEX, DISTANCE, TYPE)`):
- Per-pool-length segment record
- `SEGMENT`, `SWIM_TYPE` — stroke type, free / breast / back / fly / drill
- `STROKES`, `AVG_SWOLF`, `TIME`, `PACE`

---

## 8. `HUAWEI_DICT_DATA` and `HUAWEI_DICT_DATA_VALUES` — generic key/value streams

Entities: `HuaweiDictData`, `HuaweiDictDataValues`.

`HUAWEI_DICT_DATA` (one row per measurement window):
| Column | Meaning |
|---|---|
| `DICT_ID` | INTEGER PK AI |
| `DEVICE_ID`, `USER_ID` | FKs |
| `DICT_CLASS` | Top-level category code |
| `START_TIMESTAMP`, `END_TIMESTAMP` | Window |
| `MODIFY_TIMESTAMP` | Last edit |

`HUAWEI_DICT_DATA_VALUES` (PK `(DICT_ID, DICT_TYPE, TAG)`):
| Column | Meaning |
|---|---|
| `DICT_ID` | FK |
| `DICT_TYPE` | Sub-type (the actual metric id) |
| `TAG` | Field/component tag inside that type |
| `VALUE` | BLOB — raw bytes, decoded by metric |

This is Huawei's catch-all for arbitrary metric streams the watch fans out from native apps. Known `DICT_CLASS` / `DICT_TYPE` values from the Gadgetbridge source:

| Class / type | Meaning |
|---|---|
| `400012` | Skin temperature stream |
| `700013` | Sleep details (extra stages, awakenings) |
| `700004` | Arrhythmia / continuous-AFib alerts |
| `400xx` family | Wellness streams (mood, hydration, etc.) |
| `700xx` family | Sleep / cardiac event streams |

Both tables empty here → no skin-temp series, no extended sleep details, no arrhythmia events have been fetched.

VO2Max-as-trend (firmware ≥ 5.x on some Huawei wearables) can also flow through this dictionary path. With both `HUAWEI_WORKOUT_SUMMARY_ADDITIONAL_VALUES_SAMPLE` and `HUAWEI_DICT_DATA*` empty, every potential VO2Max storage path is empty.

---

## 9. `HUAWEI_ECG_SUMMARY_SAMPLE` and `HUAWEI_ECG_DATA_SAMPLE`

`HUAWEI_ECG_SUMMARY_SAMPLE`:
| Column | Meaning |
|---|---|
| `ECG_ID` | PK AI |
| `DEVICE_ID`, `USER_ID` | FKs |
| `START_TIMESTAMP`, `END_TIMESTAMP` | ECG recording window |
| `APP_VERSION` | Watch ECG app version |
| `AVERAGE_HEART_RATE` | bpm |
| `ARRHYTHMIA_TYPE` | Code: normal / AFib / premature beats etc. |
| `USER_SYMPTOMS` | Bitmask of user-reported symptoms |

Indexes on `START_TIMESTAMP`, `END_TIMESTAMP`, `ARRHYTHMIA_TYPE`.

`HUAWEI_ECG_DATA_SAMPLE` (PK `(ECG_ID, TIME_DELTA)`):
| Column | Meaning |
|---|---|
| `ECG_ID` | FK |
| `TIME_DELTA` | ms offset from `START_TIMESTAMP` |
| `VALUE` | REAL — ECG voltage sample (μV) |

Empty → no ECG recordings synced.

---

## 10. `BASE_ACTIVITY_SUMMARY` and Activity-Description / Tag tables

`BASE_ACTIVITY_SUMMARY` is Gadgetbridge's *device-agnostic* workout summary table. For Huawei, it is populated by `HuaweiWorkoutGbParser` after a workout sync, by translating the Huawei summary into the generic schema. Empty → corroborates that no workouts were ever synced.

| Column | Meaning |
|---|---|
| `_id` | PK |
| `NAME` | Workout title |
| `START_TIME`, `END_TIME` | Unix s |
| `ACTIVITY_KIND` | GB-mapped activity type |
| `BASE_LONGITUDE` / `BASE_LATITUDE` / `BASE_ALTITUDE` | Optional starting GPS |
| `GPX_TRACK` | Path to GPX |
| `RAW_DETAILS_PATH` | Path to raw Huawei track payload |
| `DEVICE_ID`, `USER_ID` | FKs |
| `SUMMARY_DATA` | JSON of additional summary metrics |
| `RAW_SUMMARY_DATA` | BLOB |

`ACTIVITY_DESCRIPTION` (free-text descriptions over a time range), `ACTIVITY_DESC_TAG_LINK` (M:N link), and `TAG` (user-defined tag) form a generic tagging system for any time interval — also empty.

---

## 11. What is *not* in this DB and why

- **No VO2Max** — would require a synced *running* workout (preferred) or a populated `HUAWEI_DICT_DATA` VO2Max trend. Both empty.
- **No workouts at all** — Huawei workout fetch is manual; never triggered.
- **No ECG** — never recorded on the watch, or never fetched.
- **No skin temperature series, no extended sleep details, no arrhythmia stream** — `HUAWEI_DICT_DATA` empty.
- **No swim, dive, indoor / outdoor sport telemetry** — see "no workouts".
- **No tags / activity descriptions** — user has not annotated any time interval.

To recover any of the above, the user must open Gadgetbridge → device card → menu → "Fetch workouts" / "Fetch ECG" while the watch is connected, then re-export the database.
