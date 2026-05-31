/**
 * LLM invocation wrapper for v4 slots.
 *
 * One responsibility: given (system, user, validator, model), call Ollama,
 * validate the output, and retry once with feedback on schema/grounding
 * failure. Returns ValidationResult + the run's metadata so the dispatcher
 * can build a SlotEntry envelope.
 *
 * No knowledge of slots / packages here — keeps the surface small enough
 * to swap providers later (or mock cleanly in tests).
 */

import { callOllama, type OllamaResult } from "../../ollama.ts";
import {
  buildFeedback,
  validateInsight,
  type ValidationResult,
} from "../validate/grounding.ts";

export interface InvokeLlmOpts {
  model: string;
  system_prompt: string;
  user_prompt: string;
  /** Slot's payload JSON schema for validation. */
  schema: object;
  /** Slot's input package — used for grounding (numbers must appear here). */
  pkg: unknown;
  /** Optional prose fields to scan. Defaults inside grounding.ts. */
  proseFieldsToScan?: string[];
  /** Tag forwarded to ollama.ts for log correlation. */
  tag: string;
  /** How many attempts (initial + retries). Default 2 = one retry. */
  max_attempts?: number;
  /**
   * Caller-injected dispatcher (test seam). When omitted, calls real Ollama.
   */
  invoker?: (system: string, user: string) => Promise<OllamaResult>;
}

export interface InvokeLlmResult {
  ok: boolean;
  attempts: InvocationAttempt[];
  final: InvocationAttempt;
}

export interface InvocationAttempt {
  validation: ValidationResult;
  ollama: OllamaResult;
  /** Concatenated user prompt for this attempt (initial OR initial + feedback). */
  user_prompt_used: string;
}

export async function invokeLlmForSlot(opts: InvokeLlmOpts): Promise<InvokeLlmResult> {
  const maxAttempts = Math.max(1, opts.max_attempts ?? 2);
  const dispatch = opts.invoker ?? defaultInvoker(opts.model, opts.tag);
  const attempts: InvocationAttempt[] = [];

  let userPrompt = opts.user_prompt;
  let lastValidation: ValidationResult | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const ollamaResult = await dispatch(opts.system_prompt, userPrompt);
    const validation = validateInsight(ollamaResult.content, opts.pkg, {
      schema: opts.schema,
      proseFieldsToScan: opts.proseFieldsToScan,
      promptText: opts.system_prompt,
    });
    attempts.push({
      validation,
      ollama: ollamaResult,
      user_prompt_used: userPrompt,
    });
    lastValidation = validation;
    if (validation.ok) break;
    // Build feedback for next attempt.
    const feedback = buildFeedback(validation);
    if (!feedback) break;
    userPrompt = appendFeedback(opts.user_prompt, feedback);
  }

  const final = attempts[attempts.length - 1];
  return {
    ok: lastValidation?.ok ?? false,
    attempts,
    final,
  };
}

function appendFeedback(userPrompt: string, feedback: string): string {
  return `${userPrompt}\n\n---\nKORREKTUR-HINWEIS:\n${feedback}\n\nKorrigiere die obigen Verstöße und gib eine vollständige neue Antwort.`;
}

function defaultInvoker(
  model: string,
  tag: string,
): (system: string, user: string) => Promise<OllamaResult> {
  return async (system, user) => {
    return callOllama({
      model,
      system,
      user,
      format: "json",
      tag,
    });
  };
}
