import { hkdfSync } from "node:crypto";

export type KeyPurpose = "socket-ticket" | "projection-ticket" | "session-expiry";

/**
 * One signing key per purpose, derived from AUTH_SECRET exactly as the app's
 * checkhen/lib/keys.ts derives it; keep the two in step.
 */
export function purposeKey(purpose: KeyPurpose, secret = process.env.AUTH_SECRET): Buffer | null {
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "checkhen", purpose, 32));
}
