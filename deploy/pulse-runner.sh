#!/usr/bin/env bash
set -euo pipefail
# Bootstrap state/ folder if missing
STATE_DIR="${STATE_ROOT:-/data/state}"
mkdir -p "$STATE_DIR"
if [ ! -f "$STATE_DIR/pause.json" ]; then
  echo '{"schema_version":"state/v1","paused":false,"i_feel_fine":false,"i_feel_fine_until_iso":null,"language":"de","step_change_detected_on":null}' > "$STATE_DIR/pause.json"
fi
if [ ! -f "$STATE_DIR/labs.json" ]; then
  echo '{"schema_version":"state/v1","features":{"cycle":false,"training_load":false,"illness_watch":false,"similar_day_search":false,"meal_photo":false,"voice_journal":false,"ecg":false}}' > "$STATE_DIR/labs.json"
fi
if [ ! -f "$STATE_DIR/alarm_state.json" ]; then
  echo '{"schema_version":"state/v1","snooze_until":{},"dismissed_counts":{},"muted_topics":[]}' > "$STATE_DIR/alarm_state.json"
fi
exec node_modules/.bin/tsx src/index.ts daily-watch
