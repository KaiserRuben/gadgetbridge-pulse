/**
 * Slot dispatcher — runs one slot end-to-end:
 *
 *   1. Get the slot's handler (package builder, prompts, schema).
 *   2. Build the input package from `ctx` (+ event for event slots).
 *   3. Invoke the LLM with retry-on-validation-fail.
 *   4. Produce a SlotDiff (or SlotEntry-only object the caller wraps into
 *      a diff).
 *
 * Status transitions:
 *   - validation.ok → "fresh"
 *   - validation.ok && missing soft dep → "degraded"
 *   - schema/grounding failed all attempts → "errored"
 *   - parsed.abstain === true → "abstained"
 *   - LLM call threw (ollama down, etc.) → "errored" with retry_after_ms
 *
 * Pure-ish: requires (ctx, view's expected_version) but does not touch the
 * filesystem itself. Caller wires the returned SlotDiff into the writer.
 */

import { performance } from "node:perf_hooks";

import { invokeLlmForSlot } from "./invoke-llm.ts";
import { getSlotHandler, type SlotEventRef, type SlotHandler } from "./slot-handlers.ts";
import type { OllamaResult } from "../../ollama.ts";
import type { SlotBuildContext } from "../slots/_shared.ts";
import type {
  ComputedBy,
  InputsUsed,
  Scope,
  SlotDiff,
  SlotEntry,
  SlotError,
  SlotId,
  SlotStatus,
} from "../types.ts";

const DEFAULT_MODEL = process.env.COACH_MODEL ?? "qwen3.6:latest";
const DEFAULT_RETRY_AFTER_MS = 5 * 60 * 1000;

export interface DispatchOpts {
  slot_id: SlotId;
  ctx: SlotBuildContext;
  /** Required for event slots (post_workout, anomaly_explain). */
  event?: SlotEventRef;
  /** CAS base for the resulting SlotDiff. */
  expected_view_version: number;
  /** Existing SlotEntry (lets us increment request_count + carry event_id). */
  existing?: SlotEntry | null;
  /** Override the default model. */
  model?: string;
  /** Caller-injected LLM invoker (tests). */
  invoker?: (system: string, user: string) => Promise<OllamaResult>;
  /** Hard dependency check: caller provides which deps were missing. */
  missing_soft_deps?: string[];
  /** ttl for the resulting SlotEntry (defaults to handler-aware caller). */
  ttl_ms: number;
  /** When this run was scheduled to fire (echoed back into the SlotEntry). */
  scheduled_for: string;
}

export interface DispatchResult {
  diff: SlotDiff;
  ms: number;
  attempts: number;
  /** Raw final LLM output (validated or not). Useful for error logs. */
  raw_output: string | null;
}

export async function dispatchSlot(opts: DispatchOpts): Promise<DispatchResult> {
  const t0 = performance.now();
  const handler = getSlotHandler(opts.slot_id);

  let pkg: unknown;
  try {
    pkg = await handler.buildPackage(opts.ctx, opts.event);
  } catch (err) {
    return errored(handler, opts, "package_build_failed", err, t0, 0, null);
  }

  let invocation;
  try {
    invocation = await invokeLlmForSlot({
      model: opts.model ?? DEFAULT_MODEL,
      system_prompt: handler.system_prompt,
      user_prompt: handler.buildUserPrompt(pkg),
      schema: handler.schema,
      pkg,
      tag: `v4:${opts.slot_id}`,
      max_attempts: 2,
      proseFieldsToScan: handler.proseFieldsToScan,
      invoker: opts.invoker,
    });
  } catch (err) {
    return errored(handler, opts, "llm_call_failed", err, t0, 0, null);
  }

  const final = invocation.final;
  const ms = Math.round(performance.now() - t0);

  if (!invocation.ok) {
    return {
      diff: buildDiff({
        handler,
        opts,
        status: "errored",
        payload: null,
        ms,
        error: {
          code: "validation_failed",
          message: [
            ...final.validation.schemaErrors,
            ...final.validation.groundingErrors,
          ].slice(0, 6).join("; "),
          retry_after_ms: DEFAULT_RETRY_AFTER_MS,
        },
        request_count_inc: invocation.attempts.length,
        facts_hash: handler.factsHash(pkg),
      }),
      ms,
      attempts: invocation.attempts.length,
      raw_output: final.ollama.content,
    };
  }

  const parsed = final.validation.parsed as { abstain?: boolean } | null;
  const abstained = parsed?.abstain === true;
  const degraded = !abstained && (opts.missing_soft_deps ?? []).length > 0;
  const status: SlotStatus = abstained ? "abstained" : degraded ? "degraded" : "fresh";

  return {
    diff: buildDiff({
      handler,
      opts,
      status,
      payload: final.validation.parsed,
      ms,
      error: null,
      request_count_inc: invocation.attempts.length,
      facts_hash: handler.factsHash(pkg),
      degraded_reason: degraded
        ? `missing prior slots: ${(opts.missing_soft_deps ?? []).join(", ")}`
        : null,
    }),
    ms,
    attempts: invocation.attempts.length,
    raw_output: final.ollama.content,
  };
}

// ── Diff construction ─────────────────────────────────────────────────────

interface BuildDiffArgs {
  handler: SlotHandler;
  opts: DispatchOpts;
  status: SlotStatus;
  payload: unknown;
  ms: number;
  error: SlotError | null;
  request_count_inc: number;
  facts_hash: string;
  degraded_reason?: string | null;
}

function buildDiff(args: BuildDiffArgs): SlotDiff {
  const { handler, opts } = args;
  const computedBy: ComputedBy = {
    model: opts.model ?? DEFAULT_MODEL,
    slot_version: handler.slot_version,
    prompt_version: handler.prompt_version,
  };
  const inputs: InputsUsed = {
    prior_slot_refs: [],          // worker fills if we want — start empty
    data_window: {
      from: opts.ctx.now.toISOString(),
      to: opts.ctx.now.toISOString(),
    },
    facts_hash: args.facts_hash,
  };
  const baseEntry: SlotEntry = {
    slot_id: opts.slot_id,
    status: args.status,
    scheduled_for: opts.scheduled_for,
    ttl_ms: opts.ttl_ms,
    computed_at: opts.ctx.now.toISOString(),
    computed_by: computedBy,
    payload: args.payload,
    inputs_used: inputs,
    error: args.error,
    degraded_reason: args.degraded_reason ?? null,
    request_count: (opts.existing?.request_count ?? 0) + args.request_count_inc,
    version: opts.existing?.version ?? 0,
  };

  const diff: SlotDiff = {
    scope: handler.scope,
    period_key: opts.ctx.period_key,
    slot_id: opts.slot_id,
    entry: baseEntry,
    expected_version: opts.expected_view_version,
  };
  if (opts.slot_id === "post_workout" && opts.event?.post_workout) {
    diff.event_id = opts.event.post_workout.event_id;
  } else if (opts.slot_id === "anomaly_explain" && opts.event?.anomaly_explain) {
    diff.event_id = opts.event.anomaly_explain.event_id;
  }
  // Use args.ms — currently we don't surface duration in the entry; future
  // expansion point. void to keep TS happy if unused.
  void args.ms;
  return diff;
}

function errored(
  handler: SlotHandler,
  opts: DispatchOpts,
  code: string,
  err: unknown,
  t0: number,
  attempts: number,
  raw: string | null,
): DispatchResult {
  const ms = Math.round(performance.now() - t0);
  return {
    diff: buildDiff({
      handler,
      opts,
      status: "errored",
      payload: null,
      ms,
      error: {
        code,
        message: err instanceof Error ? err.message : String(err),
        retry_after_ms: DEFAULT_RETRY_AFTER_MS,
      },
      request_count_inc: 0,
      facts_hash: "build_failed",
    }),
    ms,
    attempts,
    raw_output: raw,
  };
}

// ── Re-exports for daemon consumers ────────────────────────────────────────

export type { Scope, SlotEntry, SlotDiff };
