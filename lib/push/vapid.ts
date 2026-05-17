/**
 * VAPID config loader (server-only).
 *
 * Reads VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT from process.env.
 * Generate the keypair once with `npx web-push generate-vapid-keys --json`
 * and persist it to runner/.vapid-keys.json (gitignored). On the Pi, paste the
 * values into the Next.js .env.local so they reach this loader.
 *
 * Used by: app/api/push/subscribe, app/api/push/test, app/api/push/unsubscribe,
 * runner/src/scheduler/push-dispatcher (when wired in a follow-up task).
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cached: VapidConfig | null = null;

/**
 * Load and validate the VAPID configuration from environment variables.
 *
 * Throws a descriptive Error if any required variable is missing or if the
 * subject does not look like a `mailto:` / `https:` URI (web-push rejects
 * other forms).
 */
export function getVapidConfig(): VapidConfig {
  if (cached) return cached;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  const missing: string[] = [];
  if (!publicKey) missing.push("VAPID_PUBLIC_KEY");
  if (!privateKey) missing.push("VAPID_PRIVATE_KEY");
  if (!subject) missing.push("VAPID_SUBJECT");

  if (missing.length > 0) {
    throw new Error(
      `[vapid] Missing required env vars: ${missing.join(", ")}. ` +
        `Generate keys with \`npx web-push generate-vapid-keys --json\` and ` +
        `add them to .env.local (see .env.example).`,
    );
  }

  if (!/^(mailto:|https:\/\/)/i.test(subject!)) {
    throw new Error(
      `[vapid] VAPID_SUBJECT must start with "mailto:" or "https://", got "${subject}".`,
    );
  }

  cached = { publicKey: publicKey!, privateKey: privateKey!, subject: subject! };
  return cached;
}

/**
 * Test-only helper: drops the cached config so subsequent reads pick up new env.
 * Avoid calling in production paths.
 */
export function __resetVapidCacheForTests(): void {
  cached = null;
}
