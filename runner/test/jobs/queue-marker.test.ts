import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  consumeMarker,
  queueDir,
  scanMarkers,
  writeMarker,
} from "../../src/jobs/queue-marker.ts";

let tmp: string;
const origInsights = process.env.INSIGHTS_ROOT;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "qmarker-"));
  process.env.INSIGHTS_ROOT = tmp;
});

afterEach(async () => {
  if (origInsights == null) delete process.env.INSIGHTS_ROOT;
  else process.env.INSIGHTS_ROOT = origInsights;
  await rm(tmp, { recursive: true, force: true });
});

describe("queue-marker", () => {
  it("writes a marker atomically to $INSIGHTS_ROOT/queue/", async () => {
    await writeMarker({
      cluster: "synthesis_v3",
      key: "2026-05-18",
      scope: "daily",
      priority: 100,
      reason: "user_requested",
    });

    const files = await readdir(queueDir());
    expect(files).toEqual(["synthesis_v3__2026-05-18__daily.json"]);
    const body = JSON.parse(
      await readFile(path.join(queueDir(), files[0]), "utf8"),
    );
    expect(body.cluster).toBe("synthesis_v3");
    expect(body.key).toBe("2026-05-18");
    expect(body.scope).toBe("daily");
    expect(body.priority).toBe(100);
    expect(body.reason).toBe("user_requested");
    expect(typeof body.requested_at).toBe("string");
  });

  it("scanMarkers returns empty when queue dir is missing", async () => {
    expect(await scanMarkers()).toEqual([]);
  });

  it("scanMarkers parses valid markers and skips junk", async () => {
    const dir = queueDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "weekly_recap__2026-W21__weekly.json"),
      JSON.stringify({
        cluster: "weekly_recap",
        key: "2026-W21",
        scope: "weekly",
        priority: 50,
        reason: "user_requested",
        requested_at: "2026-05-18T00:00:00Z",
      }),
    );
    // Junk filename — should be swept on scan.
    await writeFile(path.join(dir, "garbage.json"), "{}");
    // Mid-write tmp — should be skipped, not parsed.
    await writeFile(path.join(dir, "x.tmp.1234.5678"), "partial");

    const markers = await scanMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0].cluster).toBe("weekly_recap");
    expect(markers[0].scope).toBe("weekly");
    expect(markers[0].filename).toBe(
      "weekly_recap__2026-W21__weekly.json",
    );

    const remaining = await readdir(dir);
    expect(remaining).not.toContain("garbage.json"); // swept
    expect(remaining).toContain("x.tmp.1234.5678"); // kept
  });

  it("consumeMarker deletes the file", async () => {
    await writeMarker({
      cluster: "morning_insight",
      key: "2026-05-18",
      scope: "daily",
      priority: 100,
      reason: "user_requested",
    });
    const before = await scanMarkers();
    expect(before).toHaveLength(1);

    await consumeMarker(before[0].filename);

    const after = await scanMarkers();
    expect(after).toHaveLength(0);
  });

  it("rejects path-traversal in filename components", async () => {
    await expect(
      writeMarker({
        cluster: "../etc/passwd",
        key: "2026-05-18",
        scope: "daily",
        priority: 0,
        reason: "x",
      }),
    ).rejects.toThrow(/unsafe/);
  });

  it("second writeMarker overwrites the first (idempotent)", async () => {
    await writeMarker({
      cluster: "synthesis_v3",
      key: "2026-05-18",
      scope: "daily",
      priority: 50,
      reason: "first",
    });
    await writeMarker({
      cluster: "synthesis_v3",
      key: "2026-05-18",
      scope: "daily",
      priority: 100,
      reason: "second",
    });

    const markers = await scanMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0].priority).toBe(100);
    expect(markers[0].reason).toBe("second");
  });
});
