# Gadgetbridge.db — Investigation Index

Source DB: `$PULSE_ROOT/Gadgetbridge.db` (~800 KB, SQLite 3.x, schema v128).
Device: HUAWEI WATCH GT 5 Pro (model `Vili-B29F`, MAC `XX:XX:XX:XX:XX:XX`, firmware `6.0.0.23(SP10C00M06)`).
User: example profile (id 1, gender=male, height 180 cm, weight 75 kg, step goal 10000, sleep goal 420 min).
Window: ~16 h sample (example timestamps below are illustrative).

## Populated tables — ground truth

| Rows | Table | Domain |
|---|---|---|
| 1944 | HUAWEI_ACTIVITY_SAMPLE | minute steps/cal/dist/HR/SpO2 |
| 904 | HUAWEI_TEMPERATURE_SAMPLE | skin temperature (1/min) |
| 524 | HUAWEI_SLEEP_STAGE_SAMPLE | minute sleep stages |
| 62 | HUAWEI_HRV_VALUE_SAMPLE | HRV (ms, RMSSD-like) |
| 29 | HUAWEI_STRESS_SAMPLE | stress 0–100 + bucket |
| 20 | BATTERY_LEVEL | battery % |
| 9 | CALENDAR_SYNC_STATE | calendar sync hashes |
| 6 | ALARM | all disabled stubs |
| 2 | USER_ATTRIBUTES | profile (old + current) |
| 2 | HUAWEI_SLEEP_APNEA_SAMPLE | apnea events |
| 1 | USER | profile core |
| 1 | HUAWEI_SLEEP_STATS_SAMPLE | nightly summary |
| 1 | DEVICE | watch identity |
| 1 | DEVICE_ATTRIBUTES | firmware version |

All other ~110 tables are empty (other-vendor schemas + unused Huawei subtables).

## Per-domain docs

| File | Scope |
|---|---|
| [01_activity.md](01_activity.md) | activity samples — steps, calories, distance, HR, SpO2 series, RAW_KIND/SOURCE codes, battery |
| [02_sleep.md](02_sleep.md) | sleep stages (1=light, 2=REM, 3=deep, 4=awake), nightly stats row, apnea events |
| [03_biometrics.md](03_biometrics.md) | temperature (skin), HRV, stress; missing: emotions, ECG, body temp, BP, glucose, weight, RR-intervals, training load |
| [04_workouts.md](04_workouts.md) | all HUAWEI_WORKOUT_* + HUAWEI_DICT_DATA + ECG schemas — empty (no workout fetched, no VO2Max) |
| [05_metadata.md](05_metadata.md) | DEVICE, USER, USER_ATTRIBUTES, ALARM, CALENDAR_SYNC_STATE |

## Coverage matrix vs requested domains

| Requested | Status | Where |
|---|---|---|
| Calories | Present (raw firmware unit, NOT kcal) | HUAWEI_ACTIVITY_SAMPLE.CALORIES |
| Temperature | Present (skin, 30.6–35.5 °C, 904 samples) | HUAWEI_TEMPERATURE_SAMPLE |
| O₂ in blood (SpO₂) | Present (59 readings, 95–99 %) | HUAWEI_ACTIVITY_SAMPLE.SPO + sleep_stats AVG_OXYGEN_SATURATION |
| Stress | Present (29 samples, 15–63, never high) | HUAWEI_STRESS_SAMPLE |
| Steps | Present (real total ~420 over 16 h — under-counted by sentinels) | HUAWEI_ACTIVITY_SAMPLE.STEPS |
| Heart rate | Present (284 samples, 48–126 bpm + outlier −125 = signed-byte overflow ~131) | HUAWEI_ACTIVITY_SAMPLE.HEART_RATE + RESTING_HEART_RATE |
| **VO2Max** | **MISSING** — would live in HUAWEI_WORKOUT_SUMMARY_ADDITIONAL_VALUES_SAMPLE (key='vo2max') or HUAWEI_DICT_DATA. Both empty. Need workout fetch. |
| HRV | Present (62 samples, 9–118 ms, mean 61) | HUAWEI_HRV_VALUE_SAMPLE + sleep_stats AVG_HRV |
| Sleep | Present (one full night, score 83, 8 h 44 m in bed) | HUAWEI_SLEEP_STAGE/STATS/APNEA |
| Activity | Present (16 h continuous minute grid) | HUAWEI_ACTIVITY_SAMPLE |
| Body metadata | Present (height/weight/age/gender/goals) | USER + USER_ATTRIBUTES + DEVICE_ATTRIBUTES |

## Known anomalies / data quality

1. **Negative step total (−562)** — 982 sentinel rows store STEPS=−1; real total ≈ 420 over 16 h.
2. **HR = −125 at 11:29** — signed-byte wrap of 131 bpm during workout peak. Bug.
3. **Calorie unit not kcal** — raw firmware passthrough, hourly max 25619 implausible as kcal.
4. **Distance stored ×100** — DAO scales m to cm; real walked ≈ 4.68 m total.
5. **Each minute stored twice** — forward (real data, OTHER=TS+60) + backward (all-sentinel, OTHER=TS−60).
6. **Sleep stats sentinels** — most min/max/baseline columns are −1 (not measured) but stored due to NOT NULL.
7. **RDI=−1 yet 2 apnea events** — RDI summary not computed despite event stream.
8. **Single charging cycle** — battery 93→100 % during 09:35–10:37 UTC gap.

## Missing entirely

- Workouts (manual fetch never triggered) → no GPS, pace, sections, workout HR/SpO2, VO2Max, training load.
- ECG (never recorded on watch).
- Emotions stream (Huawei rolls out gradually; absent for this firmware/locale).
- Body / core temperature (only skin temp captured).
- Dict-data streams: skin-temp class 400012, sleep-detail class 700013, arrhythmia class 700004 — all empty (Gadgetbridge decodes inline instead).
- Blood pressure, glucose, weight, RR-intervals, training-load ATL/CTL.

## Reproduce / re-query

```bash
sqlite3 "$PULSE_ROOT/Gadgetbridge.db"
.headers on
.mode column
SELECT * FROM HUAWEI_ACTIVITY_SAMPLE WHERE STEPS > 0 LIMIT 20;
```

## References

- Schema generator: <https://codeberg.org/Freeyourgadget/Gadgetbridge/src/branch/master/GBDaoGenerator/src/nodomain/freeyourgadget/gadgetbridge/daogen/GBDaoGenerator.java>
- Huawei device code: <https://codeberg.org/Freeyourgadget/Gadgetbridge/src/branch/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei>
- Huawei dict-type IDs (`HuaweiDictTypes.java`): SKIN_TEMPERATURE_CLASS=400012, SLEEP_DETAILS_CLASS=700013, ARRHYTHMIA_CLASS=700004.
