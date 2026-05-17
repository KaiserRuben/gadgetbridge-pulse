/**
 * Per-prompt orchestrator. Run a domain prompt with retry budget.
 */

import { createHash } from "node:crypto";
import { callOllama } from "./ollama.ts";
import { validateOutput, buildRetryNote, type ValidationResult } from "./validate.ts";
import { writeAtomic, insightPath, appendBundle, periodDir } from "./output.ts";
import path from "node:path";
import { config } from "./config.ts";
import type { SnapshotFactsBundle } from "./facts/snapshot.ts";

export type PromptModule = {
  domain: string;
  timeframe: string;
  system: string;
  schema: unknown;
  buildUser: (facts: SnapshotFactsBundle) => string;
};

export type RunOpts = {
  model?: string;
  dryRun?: boolean;
};

export async function runPrompt(
  prompt: PromptModule,
  facts: SnapshotFactsBundle,
  opts: RunOpts = {},
): Promise<{ ok: boolean; reason?: string; output?: unknown }> {
  if (opts.dryRun) {
    console.log(`[dry-run] ${prompt.timeframe}/${prompt.domain} for ${facts.period_key}`);
    return { ok: true };
  }

  const factsHash = sha256(JSON.stringify(facts));
  const model = opts.model ?? config.model;
  let prev: ValidationResult | null = null;
  let totalDurMs = 0;
  let totalPromptTok = 0;
  let totalEvalTok = 0;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const retryNote = prev ? `\n\n${buildRetryNote(prev)}` : "";
    const user = prompt.buildUser(facts) + retryNote;

    console.log(
      `[${prompt.timeframe}/${prompt.domain}] attempt ${attempt}/${config.maxAttempts} model=${model}`,
    );
    const t0 = Date.now();
    let result;
    try {
      result = await callOllama({
        model,
        system: prompt.system,
        user,
        format: prompt.schema,
        options: {
          temperature: attempt === 1 ? 0.15 : Math.max(0.05, 0.15 - 0.05 * attempt),
        },
      });
    } catch (err) {
      console.error(`  HTTP error: ${err instanceof Error ? err.message : err}`);
      prev = { ok: false, reason: "parse", raw: "", error: String(err) };
      continue;
    }

    totalDurMs += result.totalMs;
    totalPromptTok += result.promptTokens;
    totalEvalTok += result.evalTokens;
    console.log(
      `  ${result.totalMs}ms · prompt=${result.promptTokens} eval=${result.evalTokens}`,
    );

    // Always dump raw output for forensics (overwrite per attempt, last wins).
    const dir = periodDir(prompt.timeframe, facts.period_key);
    await writeAtomic(
      path.join(dir, `${prompt.domain}.raw.${attempt}.txt`),
      result.content || "<empty content>",
    );
    if (result.thinking) {
      await writeAtomic(
        path.join(dir, `${prompt.domain}.thinking.${attempt}.txt`),
        result.thinking,
      );
    }

    const validation = validateOutput(result.content, prompt.schema, prompt.domain);
    if (validation.ok) {
      const enriched = {
        version: "1",
        domain: prompt.domain,
        timeframe: prompt.timeframe,
        period_key: facts.period_key,
        data_window: facts.data_window,
        generated_at: new Date().toISOString(),
        model,
        facts_hash: `sha256:${factsHash}`,
        duration_ms: totalDurMs,
        ...validation.data,
      };
      const filePath = insightPath(prompt.timeframe, facts.period_key, prompt.domain);
      await writeAtomic(filePath, JSON.stringify(enriched, null, 2));
      await appendBundle(prompt.timeframe, facts.period_key, {
        domain: prompt.domain,
        timeframe: prompt.timeframe,
        attempts: attempt,
        duration_ms: totalDurMs,
        prompt_tokens: totalPromptTok,
        eval_tokens: totalEvalTok,
        validated: true,
        confidence: typeof validation.data.confidence === "number"
          ? validation.data.confidence
          : undefined,
      });
      console.log(`  ✔ written ${filePath}`);
      return { ok: true, output: enriched };
    }

    prev = validation;
    console.warn(`  ✘ validation: ${validation.reason}`);
    if (validation.reason === "schema") {
      console.warn(
        `    errors: ${validation.errors
          .slice(0, 3)
          .map((e) => `${e.instancePath || "/"} ${e.message}`)
          .join(" | ")}`,
      );
    } else if (validation.reason === "math") {
      console.warn(
        `    reported=${validation.reported.toFixed(3)} calc=${validation.calc.toFixed(3)} Δ=${validation.delta.toFixed(3)}`,
      );
    } else if (validation.reason === "parse") {
      console.warn(`    parse error: ${validation.error.slice(0, 160)}`);
    }
  }

  // Out of attempts — write a stub but keep last-good.
  const stub = {
    version: "1",
    domain: prompt.domain,
    timeframe: prompt.timeframe,
    period_key: facts.period_key,
    generated_at: new Date().toISOString(),
    model,
    facts_hash: `sha256:${factsHash}`,
    error: prev?.reason ?? "unknown",
    confidence: 0,
  };
  const stubPath = insightPath(prompt.timeframe, facts.period_key, `${prompt.domain}.stub`);
  await writeAtomic(stubPath, JSON.stringify(stub, null, 2));
  await appendBundle(prompt.timeframe, facts.period_key, {
    domain: prompt.domain,
    timeframe: prompt.timeframe,
    attempts: config.maxAttempts,
    duration_ms: totalDurMs,
    prompt_tokens: totalPromptTok,
    eval_tokens: totalEvalTok,
    validated: false,
    reason: prev?.reason ?? "unknown",
  });
  return { ok: false, reason: prev?.reason ?? "unknown" };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
