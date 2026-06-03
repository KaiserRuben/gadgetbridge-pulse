"use client";

import { useMemo } from "react";
import { Hypnogram } from "./hypnogram";
import type { SleepStageBlock } from "@/lib/types";
import type { NightReviewStageSegment } from "@/runner/v4/slots/night-review/types.ts";

/**
 * Adapter wrapper around `<Hypnogram>` for v4 drill bodies.
 *
 * The v4 `night_review` payload carries `stages_timeline` as
 * `{start_iso, end_iso, stage: "light"|"rem"|"deep"|"awake", duration_min}[]`
 * (telemetry pass-through from the packager). `<Hypnogram>` consumes the
 * legacy domain shape `{start: ms, end: ms, stage: 1|2|3|4}[]` plus
 * explicit window bounds.
 *
 * This adapter does the mapping in one place so both surfaces stay aligned
 * if the upstream segment shape ever changes.
 */

const STAGE_CODE: Record<NightReviewStageSegment["stage"], 1 | 2 | 3 | 4> = {
  light: 1,
  rem: 2,
  deep: 3,
  awake: 4,
};

export function SleepStagesChart({
  segments,
  height = 180,
}: {
  segments: ReadonlyArray<NightReviewStageSegment>;
  /** Bar-stack height in px. Drill bodies pass 180 on mobile, 200+ desktop. */
  height?: number;
}) {
  const { blocks, windowStart, windowEnd } = useMemo(() => {
    if (segments.length === 0) {
      return { blocks: [] as SleepStageBlock[], windowStart: 0, windowEnd: 0 };
    }
    const bs: SleepStageBlock[] = segments
      .map((s) => {
        const start = Date.parse(s.start_iso);
        const end = Date.parse(s.end_iso);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
        return { start, end, stage: STAGE_CODE[s.stage] } as SleepStageBlock;
      })
      .filter((b): b is SleepStageBlock => b !== null);
    if (bs.length === 0) {
      return { blocks: [] as SleepStageBlock[], windowStart: 0, windowEnd: 0 };
    }
    const min = Math.min(...bs.map((b) => b.start));
    const max = Math.max(...bs.map((b) => b.end));
    return { blocks: bs, windowStart: min, windowEnd: max };
  }, [segments]);

  return (
    <Hypnogram
      blocks={blocks}
      windowStart={windowStart}
      windowEnd={windowEnd}
      height={height}
    />
  );
}
