import { createHmac } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireScope } from '@/lib/request-scope';
import { readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';

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
    ...context.scope, userId: context.user.id, admin: context.admin, expires: Date.now() + 60_000,
  })).toString('base64url');
  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(503).json({ message: 'Server authentication is not configured' });
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return res.json({ ticket: payload + '.' + signature });
}
