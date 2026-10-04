import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EventScope } from './events';

type ProjectionClaim = EventScope & { projection: true; expires: number };

export function mintProjectionTicket(scope: EventScope, expires: number, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ ...scope, projection: true, expires })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyProjectionTicket(ticket: string, secret: string, now = Date.now()): ProjectionClaim | null {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !secret) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(parts[0]).digest('base64url'));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const claim = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (claim.projection !== true || typeof claim.courseId !== 'string' || !claim.courseId ||
        typeof claim.classId !== 'string' || !claim.classId ||
        typeof claim.expires !== 'number' || claim.expires <= now) return null;
    return claim;
  } catch { return null; }
}
