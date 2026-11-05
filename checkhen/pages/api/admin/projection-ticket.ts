import type { NextApiRequest, NextApiResponse } from 'next';
import { readState } from '@/lib/event-store';
import { purposeKey } from '@/lib/keys';
import { prisma } from '@/lib/prisma';
import { mintProjectionTicket } from '@/lib/projection-auth';
import { requireScope } from '@/lib/request-scope';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const context = await requireScope(req, res, true);
  if (!context) return;
  const key = purposeKey('projection-ticket');
  if (!key) return res.status(503).json({ message: 'Server authentication is not configured' });
  const end = context.selected.createdAt.getTime() + context.selected.duration * 60000;
  const state = await readState(prisma, context.scope);
  if (end <= Date.now() || state.endedAt)
    return res.status(400).json({ message: 'Class has ended' });
  const expires = Math.min(end, Date.now() + 4 * 60 * 60 * 1000);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ticket: mintProjectionTicket(context.scope, expires, state.projectionGeneration, key),
    expires,
  });
}
