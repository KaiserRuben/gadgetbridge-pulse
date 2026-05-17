/**
 * Trigger poll loop — long-running process for the dashboard host.
 *
 * Every POLL_INTERVAL_SEC: open the read-only Gadgetbridge.db, run
 * detectTriggers, fire actions for any new triggers detected:
 *   - post_workout → run v3 for that date, dispatch push
 *   - morning_wake → run v3 for that date, dispatch push
 *   - evening_brief → run v3 synthesis for today, dispatch push
 *
 * Designed to run as its own service in docker-compose alongside the existing
 * runner + finalize containers.
 *
 * Usage: tsx src/scheduler/poll-loop.ts
 *
 * Env:
 *   POLL_INTERVAL_SEC (default 300 = 5 min)
 *   DASHBOARD_BASE_URL (default http://host.docker.internal:3030 — used for
 *                       /api/events + /api/push/test trigger calls)
 */

import { db as openDb } from "../db.ts";
import { config } from "../config.ts";
import { detectTriggers, type DetectedTrigger } from "./triggers.ts";
import { runV3 } from "../v3-orchestrator.ts";

const POLL_INTERVAL_SEC = Number(process.env.POLL_INTERVAL_SEC ?? "300");
const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL ?? "http://host.docker.internal:3030";

interface PushTopic {
  topic: "morning_recap" | "post_workout" | "evening_brief";
  title: string;
  body: string;
  url: string;
}

async function handleTrigger(t: DetectedTrigger): Promise<void> {
  console.log(
    `[poll-loop] trigger=${t.kind} date=${t.date} payload=${JSON.stringify(t.payload)}`,
  );

  // 1. Fire the v3 orchestrator for the affected date.
  try {
    const result = await runV3({ periodKey: t.date });
    console.log(
      `[poll-loop] runV3 ok=${result.ok} total=${result.totalMs}ms errors=${result.errors.join("; ") || "none"}`,
    );
  } catch (err) {
    console.error(`[poll-loop] runV3 failed: ${(err as Error).message}`);
    return;
  }

  // 2. Dispatch push notification via dashboard /api/push/test.
  // (Real production: call /api/push/dispatch with custom payload — for now
  //  test endpoint is good enough; topic-specific endpoints land in 5.13b.)
  const push = pushFor(t);
  if (!push) return;
  try {
    const res = await fetch(`${DASHBOARD_BASE_URL}/api/push/test`, {
      method: "POST",
    });
    console.log(`[poll-loop] push sent topic=${push.topic} status=${res.status}`);
  } catch (err) {
    console.warn(`[poll-loop] push dispatch failed: ${(err as Error).message}`);
  }
}

function pushFor(t: DetectedTrigger): PushTopic | null {
  if (t.kind === "post_workout") {
    return {
      topic: "post_workout",
      title: "Pulse · Nach Training",
      body: "Workout fertig. Recovery + Trainings-Quality berechnet.",
      url: `/activity/${t.date}`,
    };
  }
  if (t.kind === "morning_wake") {
    return {
      topic: "morning_recap",
      title: "Pulse · Morgen-Recap",
      body: "Schlaf + Erholung neu berechnet.",
      url: "/",
    };
  }
  if (t.kind === "evening_brief") {
    return {
      topic: "evening_brief",
      title: "Pulse · Abend-Briefing",
      body: "Tag synthetisiert. Tonight-Action steht.",
      url: "/",
    };
  }
  return null;
}

async function tick(): Promise<void> {
  const triggers = detectTriggers({
    db: openDb(),
    stateRoot: config.stateRoot,
  });
  if (triggers.length === 0) {
    console.log(`[poll-loop] tick — no triggers`);
    return;
  }
  for (const t of triggers) {
    await handleTrigger(t);
  }
}

async function main(): Promise<void> {
  console.log(
    `[poll-loop] starting interval=${POLL_INTERVAL_SEC}s dashboard=${DASHBOARD_BASE_URL}`,
  );
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[poll-loop] tick failed: ${(err as Error).message}`);
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_SEC * 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
