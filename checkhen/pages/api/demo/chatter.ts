import type { NextApiRequest, NextApiResponse } from 'next';
import { isDemo } from '@/lib/demo';
import { chatterStatus, startChatter, stopChatter } from '@/lib/demo-chatter';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';

/** Demo mode, instructor only: start, stop, or read simulated chat for a session. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }
  if (!isDemo()) {
    return res.status(404).end();
  }
  const context = await requireScope(req, res, true);
  if (!context) {
    return;
  }
  const { scope } = context;
  if (req.method === 'GET') {
    return res.json(chatterStatus(scope));
  }
  const action = req.body?.action;
  if (action === 'start') {
    return res.json(startChatter(prisma, scope));
  }
  if (action === 'stop') {
    stopChatter(scope);
    return res.json(chatterStatus(scope));
  }
  return res.status(400).json({ message: 'Choose start or stop' });
}
