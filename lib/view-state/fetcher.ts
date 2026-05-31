/**
 * Server-side ViewState fetcher.
 *
 * Used from Next.js server components / SSR boundaries. Calls
 * ViewStateReader directly — no HTTP hop, no race with the API route.
 *
 * Pi-side this reads the local view tree (under PULSE_VIEW_ROOT or
 * INSIGHTS_ROOT/view). On the Mac during dev it reads the same tree
 * via the Syncthing share.
 */

import type { ViewState } from "@/runner/v4/types.ts";
import { detectScope, getReader } from "./shared";

export { detectScope } from "./shared";

/**
 * Read a view-state doc directly. Returns null if not yet written.
 * Throws on unrecognised period_key.
 */
export async function readViewState(period_key: string): Promise<ViewState | null> {
  const scope = detectScope(period_key);
  if (!scope) throw new Error(`invalid period_key: ${period_key}`);
  return getReader().read(scope, period_key);
}
