import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyProjectionTicket } from '@/lib/projection-auth';
import { projectionChat } from '@/lib/chat-view';
import { readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const origin = req.headers.origin;
  if (origin && origin === process.env.SLIDEV_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  const ticket = req.query.ticket;
  const secret = process.env.AUTH_SECRET;
  const claim = typeof ticket === 'string' && secret ? verifyProjectionTicket(ticket, secret) : null;
  if (!claim) return res.status(403).json({ message: 'Projection access expired' });
  const scope = { courseId: claim.courseId, classId: claim.classId };
  const state = await readState(prisma, scope);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ messages: projectionChat(state.messages.slice(-100)) });
}
