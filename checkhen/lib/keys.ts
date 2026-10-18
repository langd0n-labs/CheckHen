import { hkdfSync } from 'node:crypto';

export type KeyPurpose =
  | 'socket-ticket'
  | 'projection-ticket'
  | 'session-expiry'
  | 'cold-call-draw';

/**
 * One signing key per purpose, derived from AUTH_SECRET, so a value signed for one
 * purpose is refused everywhere else. NextAuth keeps AUTH_SECRET itself.
 * socket-server/src/keys.ts derives the same keys; keep the two in step.
 */
export function purposeKey(
  purpose: KeyPurpose,
  secret: string | undefined = process.env.AUTH_SECRET
): Buffer | null {
  if (!secret) return null;
  return Buffer.from(hkdfSync('sha256', secret, 'checkhen', purpose, 32));
}
