import { NextResponse } from "next/server";

import { checkIngestAuth } from "@/lib/ingest/auth";
import {
  claimCell,
  enqueueCellPending,
  markCellStale,
  readCell,
  releaseCell,
  sweepCellLeases,
  type Scope,
  type ProvenanceTag,
} from "@/lib/data/cell-store";

export const dynamic = "force-dynamic";

function asScope(v: unknown): Scope {
  return v === "weekly" ? "weekly" : "daily";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ op: string }> },
) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const { op } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    switch (op) {
      case "claim": {
        const cluster = body.cluster as string;
        const key = body.key as string;
        const scope = asScope(body.scope);
        if (!cluster || !key) {
          return NextResponse.json({ error: "claim requires cluster, key" }, { status: 400 });
        }
        const result = claimCell(cluster, key, scope);
        return NextResponse.json({ cell: result });
      }
      case "release": {
        const cluster = body.cluster as string;
        const key = body.key as string;
        const scope = asScope(body.scope);
        if (!cluster || !key) {
          return NextResponse.json({ error: "release requires cluster, key" }, { status: 400 });
        }
        releaseCell(
          cluster,
          key,
          {
            payload: body.payload,
            provenance: Array.isArray(body.provenance)
              ? (body.provenance as ProvenanceTag[])
              : [],
          },
          (body.error as string | null) ?? null,
          scope,
        );
        return NextResponse.json({ ok: true });
      }
      case "markStale": {
        const cluster = body.cluster as string;
        const key = body.key as string;
        const scope = asScope(body.scope);
        const reason = (body.reason as string) ?? "unknown";
        if (!cluster || !key) {
          return NextResponse.json({ error: "markStale requires cluster, key" }, { status: 400 });
        }
        markCellStale(cluster, key, reason, scope);
        return NextResponse.json({ ok: true });
      }
      case "enqueue": {
        const cluster = body.cluster as string;
        const key = body.key as string;
        const scope = asScope(body.scope);
        if (!cluster || !key) {
          return NextResponse.json({ error: "enqueue requires cluster, key" }, { status: 400 });
        }
        enqueueCellPending(cluster, key, scope);
        return NextResponse.json({ ok: true });
      }
      case "sweep": {
        const ttlMs = Number(body.ttlMs);
        const maxRetries = Number(body.maxRetries);
        if (!Number.isFinite(ttlMs) || !Number.isFinite(maxRetries)) {
          return NextResponse.json({ error: "sweep requires ttlMs, maxRetries" }, { status: 400 });
        }
        const total = sweepCellLeases(ttlMs, maxRetries);
        return NextResponse.json({ swept: total });
      }
      case "read": {
        const cluster = body.cluster as string;
        const key = body.key as string;
        const scope = asScope(body.scope);
        if (!cluster || !key) {
          return NextResponse.json({ error: "read requires cluster, key" }, { status: 400 });
        }
        const cell = readCell(cluster, key, scope);
        return NextResponse.json({ cell });
      }
      default:
        return NextResponse.json({ error: `unknown op: ${op}` }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
