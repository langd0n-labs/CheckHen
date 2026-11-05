import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EventScope } from './events';

type ProjectionClaim = EventScope & {
  typ: 'projection';
  projection: true;
  expires: number;
  generation: number;
};
type Key = string | Buffer;

/**
 * A projection ticket lets a window or deck read one session's anonymous chat. It
 * carries the session's projection generation; revoking the session's projection
 * links raises the generation, which refuses every earlier ticket.
 */
export function mintProjectionTicket(
  scope: EventScope,
  expires: number,
  generation: number,
  key: Key
): string {
  const claim = { ...scope, typ: 'projection', projection: true, expires, generation };
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyProjectionTicket(
  ticket: string,
  key: Key | null,
  now = Date.now()
): ProjectionClaim | null {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !key || !key.length) return null;
  const expected = Buffer.from(createHmac('sha256', key).update(parts[0]).digest('base64url'));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const claim = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (
      claim.typ !== 'projection' ||
      claim.projection !== true ||
      typeof claim.courseId !== 'string' ||
      !claim.courseId ||
      typeof claim.classId !== 'string' ||
      !claim.classId ||
      typeof claim.expires !== 'number' ||
      claim.expires <= now ||
      !Number.isInteger(claim.generation)
    )
      return null;
    return claim;
  } catch {
    return null;
  }
}
