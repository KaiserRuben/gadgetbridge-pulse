/**
 * Re-export of the night-review entry from the central slot registry.
 * Kept as a thin re-export so per-slot worker code can `import { schedule }
 * from "../slots/night-review/schedule"` without depending on the registry
 * module name.
 */

import { getSlotEntry } from "../_registry.ts";

export const schedule = getSlotEntry("night_review");
