# Pulse v2.1 — Outside-Perspective Validation

_Reviewed: 2026-05-08_

## Verdict

**Partial ship — three critical bugs must be fixed before daily use.** Architectural skeleton is solid: LLM scope discipline is genuinely good, write-back separation between `pulse.db` and `Gadgetbridge.db` is clean, S1 safety verifier hard-fails. Foundation is shippable. Confidence: high.

---

## Per-Requirement Scorecard

| # | Requirement | Status | Issues |
|---|---|---|---|
| 1 | Awesome charts + drill-down | Partial | Sample browser returns null for every metric except `hrv_rmssd`. `/explore/correlate` absent. |
| 2 | Date navigation past days | Partial | `CalendarDrawer` never receives `dataMap` — verdict-band dots never render. |
| 3 | LLM for insights/patterns not summary | Full | All four analyzer modules scoped narrow, schema-enforced, probe-validated. |
| 4 | Good charts / data density | Partial | Week overlay is single-point per day for non-HRV metrics → flat dots, not an overlay. |
| 5 | Hybrid /today + /explore | Full | Both surfaces shipped, Explore is primary nav slot. |
| 6 | Animations as wayfinding | Partial | T1–T4 implemented. T5 heatmap-cell pulse + T8 ChartZoomSelect missing. |
| 7 | Write-back to db | Full | All log paths target `pulse.db`. No stale cross-writes. |
| 8 | Vision OCR body-comp | Full | Full loop ships. Tested only on synthetic image. |
| 9 | Narrow LLM scope | Full | Each call ≤5k tokens, `think:false`, schema-enforced. |
| 10 | Anomalies explainable on demand | **Partial — broken** | `today/page.tsx:378-394` omits `observationId`+`dateKey` from AnomalyRow calls. Why? button silently dead. |
| 11 | Coaching observational not prescriptive | Full | Zero banned phrases in 6 probe runs. Domain-coupling regex enforced. |
| 12 | S1 prose protection | Full | `S1_RELATIVIZED` is the sole `critical: true` forbidden-pattern layer. |

---

## Top 3 Critical Bugs (fix first)

### Bug 1 — "Why?" silently dead on /today anomaly rows
File: `app/(dashboard)/today/page.tsx:378-394`. AnomalyRow called without `observationId` + `dateKey`. WhyButton only renders when both are passed (`anomaly-row.tsx:94`). Anomaly id already on the data; dateKey already in scope. Two-prop addition.

### Bug 2 — Reasoning trace unconditional in production
File: `today/page.tsx:417-436`. Always-on `<details>` element. Interaction-map Decision Log #12 explicitly requires removal. Need dev-flag gate or full removal.

### Bug 3 — CalendarDrawer has no verdict-band dots
File: `date-strip.tsx:197`. CalendarDrawer rendered without `dataMap`. The `cells` array on DateStrip already has the band info — just needs to be passed through as a Map.

---

## Top 5 Missing Pieces

1. `/explore/correlate` — entire route absent.
2. Sample browser only works for HRV — null for sleep, HR, stress, SpO2, steps.
3. Explore footer link on /today (`<Link href="/explore?date={dateKey}">`) absent.
4. Pattern naming re-probe not done — code ships salience injection but unvalidated against S1 tachycardia mislabel.
5. CoachCardV2 doesn't surface `confidence` field — users see trajectory from 4-day-data without "wenig Daten" indicator.

---

## Other Bugs (medium priority)

- **detectAnomalies() not date-aware**: historical date views on `/today?date=X` show today's anomaly rows, not the requested date's.
- **Week overlay flat**: single-point series per day for daily-aggregate metrics. Render as bar comparison instead of line overlay.
- **fragile badge dead code**: `surprise-ranking.ts:228` skips all `label === "low"` candidates, fragile forces low — UI badge unreachable.
- **`.ts` extension in app-layer imports**: `explain-anomaly/route.ts:11` non-standard.
- **Desktop nav inconsistency**: Woche stays primary on desktop per `constants.ts:96-101` though spec says More sheet.

---

## Architectural Concerns

- **Ollama cross-host on Pi**: All LLM callers default `localhost:11434`. No startup validation. On Pi, `OLLAMA_URL` must point to Mac LAN IP or all LLM features silently fail.
- **Syncthing race on pulse.db**: pulse.db inside Syncthing share. WAL prevents corruption but conflict copies accumulate.
- **IS_NEXT_BUILD guard fragile**: any module that runs a DB query at import time still fails on Pi build where Mac paths don't exist.
- **Vision confidence calibration**: PROBE found qwen3.6 returns "high" for everything. The "reject if confidence ≠ high" rule isn't enforced; medium auto-accepts.

---

## Reduce-Confidence (smoke passed, real-data doubtful)

- Real Huawei Health screenshots untested. Synthetic image was 360×720; resize cap is 640px (PROBE recommended 720).
- Pattern naming may still mislabel safety-relevant clusters until re-probe confirms `salient_flags` injection.
- `detectAnomalies` returns today's data regardless of historical `?date=` param.
