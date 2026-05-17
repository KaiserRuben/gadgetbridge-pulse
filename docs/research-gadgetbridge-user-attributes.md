# Gadgetbridge `USER_ATTRIBUTES` — third-party write safety (Huawei Watch GT 5 Pro)

## 1. TL;DR + recommendation

**Recommendation: (a) Write directly to `USER_ATTRIBUTES`** using the versioned pattern: insert a new row with `VALID_FROM_UTC = now`, `VALID_TO_UTC = NULL`, and update the previous active row's `VALID_TO_UTC = now - 1 minute`. Then **also** write the same value into the SharedPreferences-backed `ActivityUser` keys via the GB UI (or accept that the GB app's "About you" screen will overwrite our row the next time the user opens it).

Why safe: GB's Huawei service is **strictly outbound** for user profile data — no `Get*UserInfo` request exists, no inbound packet handler writes `USER_ATTRIBUTES`. Source of truth on the GB side is `SharedPreferences`, not the device. The DB row is a derived audit trail, written only by `DBHelper.ensureUserAttributes()` and only when GB notices prefs disagree with the latest active row.

Single biggest risk: if the user opens GB → "About you" with stale prefs (which still hold the old values from before our edit), `ensureUserAttributes()` will see prefs ≠ latest row and write a third row reverting to the old values. Mitigation noted in §6.

## 2. Schema observed

`$PULSE_ROOT/Gadgetbridge.db`:

```sql
CREATE TABLE "USER_ATTRIBUTES" (
  "_id" INTEGER PRIMARY KEY,
  "HEIGHT_CM" INTEGER NOT NULL,
  "WEIGHT_KG" INTEGER NOT NULL,
  "SLEEP_GOAL_HPD" INTEGER,            -- legacy hours-per-day (nullable)
  "STEPS_GOAL_SPD" INTEGER,
  "VALID_FROM_UTC" INTEGER,
  "VALID_TO_UTC" INTEGER,
  "SLEEP_GOAL_MPD" INTEGER,            -- newer minutes-per-day
  "USER_ID" INTEGER NOT NULL
);
```

Example rows showing the pattern in practice (illustrative — defaults + a single user correction):

```
1|175|70||8000 |<epoch-ms initial>|<epoch-ms superseded>|420|1   <- closed (GB defaults)
2|H  |W ||SPD  |<epoch-ms now>    |<NULL>                |420|1   <- active (user-corrected)
```

Two rows, identical `USER_ID=1`, the older one has a non-NULL `VALID_TO_UTC` and the active one has NULL. `SLEEP_GOAL_HPD` is empty; `SLEEP_GOAL_MPD=420` (7 h). This proves the versioning is real, not theoretical.

`USER` table is a single static row (`name | birthday | gender`).

## 3. Write paths in Gadgetbridge code

Single writer: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/database/DBHelper.java`.

- `getUser(...)` (entry point) → calls `ensureUserAttributes(user, prefsUser, session)` every time GB resolves the user.
- `hasUpToDateUserAttributes(...)` iterates `user.getUserAttributesList()`, skips rows where `isValidNow(attr)` is false, then calls `isEqual(attr, prefsUser)` (compares HEIGHT_CM, WEIGHT_KG, SLEEP_GOAL, STEPS_GOAL). Returns `true` only if some currently-valid row matches all four.
- If false, the path is:
  1. `userAttributes.setValidToUTC(now - 1 min); session.getUserAttributesDao().update(...)` on the previous active row.
  2. Construct `new UserAttributes()`, `setValidFromUTC(now)`, populate height/weight/goals from `prefsUser`, `insert()`. `VALID_TO_UTC` is left null on the new row.
- `getUserAttributes(user)` returns `user.getUserAttributesList().get(0)`. The DAO relation in `GBDaoGenerator` is **ordered descending by `validFromUTC`**, so element 0 is the newest. `validToUTC == NULL` is the active-row marker but reads only require "newest by validFromUTC".

The values themselves never come from the DB at runtime: `model/ActivityUser.java` reads them from `SharedPreferences` (`PREF_USER_HEIGHT_CM`, `PREF_USER_WEIGHT_KG`, `PREF_USER_STEPS_GOAL`, `PREF_USER_SLEEP_DURATION`). The DB is a historical sidecar.

## 4. Sync behavior (Huawei coordinator)

Inspected `app/src/main/java/.../service/devices/huawei/requests/`. Profile-related files:

- `SendFitnessUserInfoRequest.java` — reads `activityUser.getGender/getDateOfBirth/getHeightCm/getWeightKg/getAge`, serialises, sends to watch. **No DB write.**
- `SendFitnessGoalRequest.java` — reads `GBApplication.getPrefs().getInt(ActivityUser.PREF_USER_STEPS_GOAL, ...)`, sends. **No DB write.**

There is **no** `GetUserInfo*`, `GetProfile*`, or inbound parser that writes `USER_ATTRIBUTES`. The `Get*` files in the Huawei requests directory are limited to: battery, status, contacts count, step/sleep/workout data, fitness totals, wear status. None touch user profile.

Conclusion: **Huawei sync does not overwrite `USER_ATTRIBUTES`**. Watch is a sink, not a source, for user profile data in GB.

## 5. Versioning convention in practice

Your live DB confirms GB does append-and-close, not single-row-replace. The convention `ensureUserAttributes` enforces:

- Active row = `VALID_TO_UTC IS NULL` AND newest `VALID_FROM_UTC`.
- Closing a row uses `now - 1 minute` (deliberate gap to avoid same-millisecond ties).
- New row's `VALID_FROM_UTC = now`, leaving a 60s "no valid row" window — `isValidNow` will return false for both rows during that window, but reads use `getUserAttributesList().get(0)` which returns newest regardless of `VALID_TO_UTC` status. So readers are fine.

If we mimic this exactly, GB's own `hasUpToDateUserAttributes` will see the latest row, run `isEqual(attr, prefsUser)` against `SharedPreferences`, and:

- If prefs match our written row → returns true, no rewrite, our row stands.
- If prefs differ → GB closes our row and inserts a fresh one with the prefs value. **Our edit is undone.**

## 6. Risks and edge cases

1. **Prefs drift (the big one).** GB's source of truth for height/weight/goals is `SharedPreferences`, not `USER_ATTRIBUTES`. Whenever any code path resolves the user (`DBHelper.getUser`), it will reconcile. If we write a new height to the DB but prefs still say the old value, GB invalidates our row on next user resolution. This happens on app launch, on charts opening, and likely on every device connect. **Mitigation: also push the value into prefs.** This requires either (i) the user opening GB → About you and re-saving, or (ii) Pulse mutating the preferences XML — feasible only if Pulse runs on the Android side. Since Pulse reads the DB via Syncthing on macOS, prefs writes are not feasible from Pulse.

2. **Import/zip restore wipes everything.** If the user runs Settings → Data management → Import zip, GB does a whole-file copy (`FileUtils.copyStreamToFile`) replacing the DB. Any Pulse-written rows survive only if they were in the imported zip. Acceptable — disasters wipe everything.

3. **Schema drift.** `SLEEP_GOAL_HPD` (hours) is empty in your DB; current GB writes `SLEEP_GOAL_MPD` (minutes). Pulse must write the minutes column and leave HPD null to match GB's current behaviour, or both columns to be safe.

4. **Multiple users.** Single-user DBs are the norm; `USER_ID = 1` is hard-coded by `getUser` taking `users.get(0)`. Pulse should look up the active user_id from the `USER` table rather than assuming 1.

5. **Versioning gap.** The 60-second invalid window between closed-old and open-new is by design. Pulse should follow it.

## 7. Recommended write strategy for Pulse #56

Approach **(a) with a sidecar fallback**. Concretely:

1. On Pulse-side edit:
   - `UPDATE USER_ATTRIBUTES SET VALID_TO_UTC = strftime('%s','now')*1000 - 60000 WHERE USER_ID = ? AND VALID_TO_UTC IS NULL;`
   - `INSERT INTO USER_ATTRIBUTES (HEIGHT_CM, WEIGHT_KG, SLEEP_GOAL_MPD, STEPS_GOAL_SPD, VALID_FROM_UTC, VALID_TO_UTC, USER_ID) VALUES (?, ?, ?, ?, strftime('%s','now')*1000, NULL, ?);`
   - Carry forward unchanged columns from the previous active row so `isEqual` cannot trigger on a column we didn't intend to change.
2. **Also** maintain `PULSE_USER_ATTRIBUTES` (sidecar) with the same values plus a `pulse_authoritative_at` timestamp. Pulse's reads union both with PULSE winning when newer. This survives the prefs-drift case where GB silently reverts our `USER_ATTRIBUTES` row — Pulse's UI still shows the user-intended value, even though GB's UI does not.
3. Document in user-facing copy: "edits sync to Gadgetbridge only after you re-open the GB → About you screen" — that's when prefs get rewritten and the DB row sticks.

This is the cheapest path that gets correct behaviour for charts (Pulse always right) without forking GB. Going pure-(b) is overkill given Huawei is read-only on the device side. Going pure-(d) discards usable structure — the versioning is real and the data is accurate.

## 8. Sources

- Schema, live data: `$PULSE_ROOT/Gadgetbridge.db` (queried via `sqlite3 .schema USER_ATTRIBUTES` and `SELECT * FROM USER_ATTRIBUTES`).
- `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/database/DBHelper.java` — `getUser`, `getUserAttributes` (~line 144), `ensureUserAttributes` (~line 189), `hasUpToDateUserAttributes`, `isEqual(UserAttributes, ActivityUser)`. https://github.com/Freeyourgadget/Gadgetbridge/blob/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/database/DBHelper.java
- `GBDaoGenerator/src/.../daogen/GBDaoGenerator.java` — `addUserAttributes` entity, `ValidByDate` interface, ordered-by-`validFromUTC`-desc relation. https://github.com/Freeyourgadget/Gadgetbridge/blob/master/GBDaoGenerator/src/nodomain/freeyourgadget/gadgetbridge/daogen/GBDaoGenerator.java
- `app/src/main/java/.../model/ActivityUser.java` — fetchPreferences reads `PREF_USER_HEIGHT_CM`, `PREF_USER_WEIGHT_KG`, `PREF_USER_STEPS_GOAL`, `PREF_USER_SLEEP_DURATION` from `SharedPreferences`.
- `app/src/main/java/.../service/devices/huawei/requests/SendFitnessUserInfoRequest.java` — outbound only; reads ActivityUser, no DB write.
- `app/src/main/java/.../service/devices/huawei/requests/SendFitnessGoalRequest.java` — outbound only; reads prefs directly, no DB write.
- Huawei requests directory listing — no `Get*UserInfo`/`Get*Profile`/`Get*Goal` files. https://github.com/Freeyourgadget/Gadgetbridge/tree/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huawei/requests
- Data management wiki: https://gadgetbridge.org/internals/development/data-management/ and https://codeberg.org/Freeyourgadget/Gadgetbridge/wiki/Data-Export-Import-Merging-Processing — confirms zip import = whole-file replace.
