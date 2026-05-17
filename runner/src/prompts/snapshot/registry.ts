/**
 * Snapshot prompt registry. Each domain prompt module imports this and
 * registers itself; index.ts iterates over the registry to run all prompts.
 *
 * Registration is via direct mutation; module evaluation order is determined
 * by index.ts's import statements, so registration is deterministic.
 */

import type { PromptModule } from "../../orchestrator.ts";

export const SNAPSHOT_REGISTRY: Record<string, PromptModule> = {};

export function register(prompt: PromptModule) {
  SNAPSHOT_REGISTRY[prompt.domain] = prompt;
}
