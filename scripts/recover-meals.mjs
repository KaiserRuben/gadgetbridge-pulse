#!/usr/bin/env node
/**
 * One-shot recovery: push meals stranded in the Mac pulse.db to the Pi via
 * /api/ingest/meal. Walks PULSE_MEAL on the source DB, hydrates components +
 * photos, and POSTs each meal in classified/edited form. The pi handler
 * upserts when the row is missing (bootstrap path).
 *
 * Usage:
 *   PULSE_INGEST_BASE_URL=http://pi:3030 \
 *   PULSE_INGEST_TOKEN=... \
 *   node scripts/recover-meals.mjs [--db <path>] [--period <YYYY-MM-DD>] [--dry-run]
 *
 * Defaults to $PULSE_DB_PATH or "$PULSE_ROOT/pulse.db".
 */
import Database from "better-sqlite3";
import { argv, env, exit } from "node:process";

function parseArgs() {
  const out = { db: null, period: null, dry: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--period") out.period = argv[++i];
    else if (a === "--dry-run" || a === "--dry") out.dry = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/recover-meals.mjs [--db <path>] [--period <YYYY-MM-DD>] [--dry-run]",
      );
      exit(0);
    }
  }
  return out;
}

function resolveDbPath(cli) {
  if (cli) return cli;
  if (env.PULSE_DB_PATH) return env.PULSE_DB_PATH;
  if (env.PULSE_ROOT) return `${env.PULSE_ROOT}/pulse.db`;
  throw new Error("set --db, $PULSE_DB_PATH or $PULSE_ROOT");
}

function jsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

async function postMeal(baseUrl, token, body) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/ingest/meal`;
  const idemKey = `recover-meal|${body.id}|${body.classified_at ?? ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

async function main() {
  const args = parseArgs();
  const baseUrl = env.PULSE_INGEST_BASE_URL;
  const token = env.PULSE_INGEST_TOKEN;
  if (!baseUrl || !token) {
    console.error("PULSE_INGEST_BASE_URL and PULSE_INGEST_TOKEN required");
    exit(2);
  }
  const dbPath = resolveDbPath(args.db);
  console.log(`source pulse.db: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  const where = args.period
    ? "WHERE status IN ('classified','edited') AND period_key = ?"
    : "WHERE status IN ('classified','edited')";
  const params = args.period ? [args.period] : [];
  const meals = db
    .prepare(
      `SELECT id, user_meal_at, period_key, photo_path, photo_mime, user_text,
              notes, status, source, kind, classified_at, edited_at, totals_json
         FROM PULSE_MEAL ${where}
         ORDER BY user_meal_at`,
    )
    .all(...params);

  if (meals.length === 0) {
    console.log("no classified/edited meals to recover");
    return;
  }
  console.log(`found ${meals.length} meal(s) to recover`);

  const compStmt = db.prepare(
    `SELECT id, ord, food_key, label, grams, confidence, source,
            nutrition_json, provenance_json
       FROM PULSE_MEAL_COMPONENT WHERE meal_id = ? ORDER BY ord`,
  );
  const photoStmt = db.prepare(
    `SELECT path, mime, kind, captured_at
       FROM PULSE_MEAL_PHOTO WHERE meal_id = ? ORDER BY ord`,
  );

  let ok = 0;
  let fail = 0;
  for (const m of meals) {
    const components = compStmt.all(m.id).map((c) => {
      const nutrition = jsonParse(c.nutrition_json, {
        per100g: {},
        totals: {},
      });
      const provenance = c.provenance_json ? jsonParse(c.provenance_json, []) : [];
      return {
        id: c.id,
        ord: c.ord,
        food_key: c.food_key,
        label: c.label,
        grams: c.grams,
        confidence: c.confidence,
        source: c.source,
        nutrition,
        provenance,
      };
    });
    const photos = photoStmt.all(m.id).map((p) => ({
      path: p.path,
      mime: p.mime,
      kind: p.kind,
      captured_at: p.captured_at,
    }));
    const body = {
      id: m.id,
      status: m.status,
      kind: m.kind,
      classified_at: m.classified_at ?? m.edited_at,
      totals: jsonParse(m.totals_json, {}),
      components,
      photos,
      photo_path: m.photo_path,
      // Bootstrap columns (the pi row may be missing entirely).
      user_meal_at: m.user_meal_at,
      period_key: m.period_key,
      source: m.source,
      user_text: m.user_text,
      notes: m.notes,
    };
    const label = `${m.id.slice(0, 8)} ${m.user_meal_at} ${m.status} ${m.kind}`;
    if (args.dry) {
      console.log(`[dry] would push ${label} (${components.length} comp, ${photos.length} photo)`);
      continue;
    }
    try {
      const r = await postMeal(baseUrl, token, body);
      if (r.ok) {
        console.log(`ok   ${label}`);
        ok++;
      } else {
        console.error(`FAIL ${label} → ${r.status} ${r.body}`);
        fail++;
      }
    } catch (err) {
      console.error(`ERR  ${label} → ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }
  console.log(`done: ${ok} ok, ${fail} failed`);
  if (fail > 0) exit(1);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
