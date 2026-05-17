# Device, User, and Configuration Metadata

Database: `Gadgetbridge.db`

This document covers all non-sample tables: device identity and firmware, user profile, alarms, calendar sync state, and the various per-device configuration tables (notifications, contacts, world clocks, firewall rules, audio recordings, etc.).

> All concrete values below (MAC, name, DOB, height, weight, timestamps) are **illustrative**, not real user data.

---

## 1. `DEVICE` — paired devices

Single row.

| Column | Value |
|---|---|
| `_id` | `1` |
| `NAME` | `HUAWEI WATCH GT 5 Pro` |
| `MANUFACTURER` | `Huawei` |
| `IDENTIFIER` | `XX:XX:XX:XX:XX:XX` (Bluetooth MAC, redacted) |
| `TYPE` | `0` (legacy field — type-code lookup, the real type is `TYPE_NAME`) |
| `TYPE_NAME` | `HUAWEIWATCHGT5` |
| `MODEL` | `Vili-B29F` (Huawei internal model code for the GT 5 Pro 46 mm Titanium) |
| `ALIAS` | *(empty)* |
| `PARENT_FOLDER` | *(empty)* |

Schema:
```
DEVICE(_id PK, NAME, MANUFACTURER, IDENTIFIER UNIQUE,
       TYPE, TYPE_NAME, MODEL, ALIAS, PARENT_FOLDER)
```

---

## 2. `DEVICE_ATTRIBUTES` — firmware versions over time

Single row (one validity period).

| Column | Value |
|---|---|
| `_id` | `1` |
| `FIRMWARE_VERSION1` | `6.0.0.23(SP10C00M06)` |
| `FIRMWARE_VERSION2` | *(empty)* |
| `VALID_FROM_UTC` | epoch-ms — first-pair timestamp |
| `VALID_TO_UTC` | *(NULL — currently in effect)* |
| `DEVICE_ID` | `1` |
| `VOLATILE_IDENTIFIER` | *(empty)* |

A single firmware row covers the period from initial pairing to now. `FIRMWARE_VERSION2` is unused for Huawei devices (Pebble / Mi-Band-style devices use it for a secondary radio firmware).

Schema:
```
DEVICE_ATTRIBUTES(_id PK, FIRMWARE_VERSION1, FIRMWARE_VERSION2,
                  VALID_FROM_UTC, VALID_TO_UTC, DEVICE_ID, VOLATILE_IDENTIFIER)
```

---

## 3. `USER` — user identity

Single row.

| Column | Value | Decoded |
|---|---|---|
| `_id` | `1` | |
| `NAME` | *(your name, as entered in Gadgetbridge)* | |
| `BIRTHDAY` | epoch-ms | date-of-birth as Date object |
| `GENDER` | `0` / `1` / `2` / `3` | see encoding below |

Gender encoding (Gadgetbridge `ActivityUser` constants):
- `0` — unknown
- `1` — male
- `2` — female
- `3` — other (newer builds)

Birthday is stored as Unix-epoch milliseconds even though only the date is meaningful — the time component is the synthetic moment the date was entered into Gadgetbridge as a `Date` object during initial setup.

Schema:
```
USER(_id PK, NAME, BIRTHDAY, GENDER)
```

---

## 4. `USER_ATTRIBUTES` — versioned anthropometrics

Two rows. Gadgetbridge keeps history with `VALID_FROM_UTC` / `VALID_TO_UTC`; the row whose `VALID_TO_UTC` is NULL is the current value.

| _id | HEIGHT_CM | WEIGHT_KG | SLEEP_GOAL_HPD | STEPS_GOAL_SPD | VALID_FROM_UTC | VALID_TO_UTC | SLEEP_GOAL_MPD | USER_ID |
|---|---|---|---|---|---|---|---|---|
| 1 | 175 | 70 | NULL | 8000 | epoch-ms (initial) | epoch-ms (superseded) | 420 | 1 |
| 2 | *(corrected height)* | *(corrected weight)* | NULL | *(your step goal)* | epoch-ms | NULL (current) | 420 | 1 |

Decoded:
- The first row carries **Gadgetbridge `ActivityUser` defaults** (175 cm, 70 kg, 8000 steps) populated at first pair. Anything the user enters during setup creates a second row with their real anthropometrics; the older row is closed via `VALID_TO_UTC`.
- `SLEEP_GOAL_HPD` (hours/day) is deprecated and is NULL on both rows. `SLEEP_GOAL_MPD` (minutes/day) replaced it; e.g. value 420 → 7 h goal.

Schema:
```
USER_ATTRIBUTES(_id PK, HEIGHT_CM, WEIGHT_KG, SLEEP_GOAL_HPD,
                STEPS_GOAL_SPD, VALID_FROM_UTC, VALID_TO_UTC,
                SLEEP_GOAL_MPD, USER_ID)
```

---

## 5. `ALARM` — six default-disabled alarm slots

Six rows, one per `POSITION` 0..5.

| DEVICE_ID | USER_ID | POSITION | ENABLED | SMART_WAKEUP | SMART_WAKEUP_INTERVAL | SNOOZE | REPETITION | HOUR | MINUTE | UNUSED | TITLE | DESCRIPTION | SOUND_CODE | BACKLIGHT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 0 | 0 | NULL | 0 | 0 | 0 | 0 | 1 | NULL | NULL | 0 | 1 |
| 1 | 1 | 1 | 0 | 0 | NULL | 0 | 0 | 0 | 0 | 1 | NULL | NULL | 0 | 1 |
| 1 | 1 | 2 | 0 | 0 | NULL | 0 | 0 | 0 | 0 | 1 | NULL | NULL | 0 | 1 |
| 1 | 1 | 3 | 0 | 0 | NULL | 0 | 0 | 0 | 0 | 1 | NULL | NULL | 0 | 1 |
| 1 | 1 | 4 | 0 | 0 | NULL | 0 | 0 | 0 | 0 | 1 | NULL | NULL | 0 | 1 |
| 1 | 1 | 5 | 0 | 0 | NULL | 0 | 0 | 0 | 0 | 1 | NULL | NULL | 0 | 1 |

All six alarms are **disabled** (`ENABLED = 0`), set to `00:00`, no repetition, no smart-wake, untitled. These are pre-allocated slot stubs that Gadgetbridge auto-creates on first connect to match the watch's six hardware alarm slots; the user has not configured any alarm.

Field meanings:
- `POSITION` — slot index on the watch (0..5 for GT 5 Pro)
- `ENABLED` — 0 / 1
- `SMART_WAKEUP` — fire within a window before HOUR:MINUTE based on light-sleep detection
- `SMART_WAKEUP_INTERVAL` — minutes window
- `SNOOZE` — snooze allowed
- `REPETITION` — bitmask of weekdays (Sun=0x01 … Sat=0x40), 0 = once
- `UNUSED` — legacy unused field (1 means "slot is empty/unconfigured")
- `SOUND_CODE` — selected ringtone id
- `BACKLIGHT` — flash backlight on alarm

---

## 6. `CALENDAR_SYNC_STATE` — nine synced calendar entries

Nine rows. Each tracks a calendar event already pushed from Android's Calendar provider to the watch and a content hash so Gadgetbridge can detect changes.

| _id | DEVICE_ID | CALENDAR_ENTRY_ID | HASH |
|---|---|---|---|
| 1 | 1 | 22 | -1575660728 |
| 2 | 1 | 19 | -205751504 |
| 3 | 1 | 41 | -1027394966 |
| 4 | 1 | 59 | 1753111090 |
| 5 | 1 | 58 | 1142749297 |
| 6 | 1 | 32 | 403980907 |
| 7 | 1 | 27 | -1304244839 |
| 8 | 1 | 73 | 1279136493 |
| 9 | 1 | 71 | 510405663 |

`CALENDAR_ENTRY_ID` is the row id from Android's `CalendarContract.Events` table; the actual event content is not stored here, only the watch-side sync state. Hash is a Java `String#hashCode` of the canonical event representation.

Nine events have been pushed, but we cannot tell from this DB which calendars they belong to — that mapping is in Android system DB, not Gadgetbridge. The presence of nine rows confirms calendar sync is enabled and has run at least once.

Schema:
```
CALENDAR_SYNC_STATE(_id PK, DEVICE_ID, CALENDAR_ENTRY_ID, HASH)
UNIQUE INDEX on (DEVICE_ID, CALENDAR_ENTRY_ID)
```

---

## 7. Empty configuration tables

The following tables exist with full schemas but contain **zero rows**:

| Table | Purpose |
|---|---|
| `REMINDER` | One-shot reminders pushed to watch |
| `WORLD_CLOCK` | Watch face world-clock cities |
| `CONTACT` | Contacts mirrored to watch dialler |
| `HEALTH_CONNECT_SYNC_STATE` | Per-data-type last-sync watermark for Android Health Connect bridging |
| `NOTIFICATION_FILTER` | Per-app notification allow/deny rules |
| `NOTIFICATION_FILTER_ENTRY` | Keyword/word entries inside a filter |
| `APP_SPECIFIC_NOTIFICATION_SETTING` | Per-app vibration/LED override |
| `INTERNET_FIREWALL_RULE` | Per-domain firewall rules (mostly Garmin/Pixoo) |
| `PENDING_FILE` | Queued fits/firmware/etc transfers |
| `AUDIO_RECORDING` | Voice memo recordings synced from watch |

These being empty is expected for a fresh pairing: the user has not configured custom notification filters, has not added world clocks or contacts to the watch, has not set up Health Connect bridging, and has no pending file transfers or voice memos.

---

## 8. Cross-table observations

- A typical first pair writes default anthropometrics (175 cm / 70 kg / 8 k steps) into `USER_ATTRIBUTES` row 1; user-entered corrections appear minutes later as row 2 with `VALID_TO_UTC=NULL`.
- `DEVICE_ATTRIBUTES.FIRMWARE_VERSION1` tracks each firmware reflashed onto the watch.
- Calendar sync, if enabled, populates `CALENDAR_SYNC_STATE` with one row per pushed event.
- Six pre-allocated `ALARM` slots exist on first pair, all disabled.
- All other configuration tables are empty until the user touches the corresponding settings.
