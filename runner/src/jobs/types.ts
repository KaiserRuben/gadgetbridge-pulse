/**
 * JobCell + provenance type shapes shared across runner/jobs and the
 * dashboard's app/api/jobs/* route handlers.
 */

export type ProvenanceSource =
  | "wearable_sensor"
  | "user_input"
  | "vlm_inferred"
  | "llm_derived"
  | "rule_computed"
  | "user_edited"
  | "seed_data"
  | "manual_log"
  | "external_db";

export interface ProvenanceTag {
  field_path: string;
  source: ProvenanceSource;
  external_id?: string;
  captured_at?: string;
  confidence?: number;
}

export interface DepRef {
  event_kind: string;
  key: string;
}

export interface PulseDataPackage<T = unknown> {
  cluster: string;
  key: string;
  scope: "daily" | "weekly";
  generated_at: string;
  payload: T;
  provenance: ProvenanceTag[];
  deps: DepRef[];
  confidence?: number;
  package_version: number;
}

/**
 * Numeric priority for the job queue. Higher wins — the in-process heap
 * (and the Redis sorted set) sort by `(priority << 32) | requestedAtMs`
 * so older requests within a tier drain FIFO.
 */
export const enum JobPriority {
  Backfill = 0,
  BackgroundRecompute = 10,
  AutoProcess = 20,
  UserRequested = 30,
}

export const MAX_RETRIES = 5;
