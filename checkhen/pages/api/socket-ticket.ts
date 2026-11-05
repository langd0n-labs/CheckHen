import { createHmac } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { readState } from '@/lib/event-store';
import { purposeKey } from '@/lib/keys';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const context = await requireScope(req, res);
  if (!context) return;
  if (!context.admin) {
    const state = await readState(prisma, context.scope);
    if (!state.attendance.some(item => item.userId === context.user.id && item.isPresent)) {
      return res.status(403).json({ message: 'Check in before connecting' });
    }
  }
  const payload = Buffer.from(JSON.stringify({
    typ: 'socket', ...context.scope, userId: context.user.id, admin: context.admin, expires: Date.now() + 60_000,
  })).toString('base64url');
  const key = purposeKey('socket-ticket');
  if (!key) return res.status(503).json({ message: 'Server authentication is not configured' });
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return res.json({ ticket: payload + '.' + signature });
}
