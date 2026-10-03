import type { NextApiRequest, NextApiResponse } from 'next';
import { requireScope } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';
import { appendEvent, readEvents, readState } from '@/lib/event-store';
import type { EventKind } from '@/lib/events';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end();
  const context = await requireScope(req, res, true);
  if (!context) return;
  if (req.method === 'GET') {
    return res.json({ events: await readEvents(prisma, context.scope), state: await readState(prisma, context.scope) });
  }
  const { kind, payload, supersedesId, userId } = req.body;
  if (typeof kind !== 'string' || (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload)))) {
    return res.status(400).json({ message: 'Invalid event' });
  }
  try {
    const event = await appendEvent(prisma, {
      ...context.scope, actorId: context.user.id, kind: kind as EventKind,
      payload, supersedesId, userId,
    });
    return res.status(201).json({ event });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid event' });
  }
}
