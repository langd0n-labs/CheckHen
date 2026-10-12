import type { NextApiRequest, NextApiResponse } from 'next';
import { isDemo } from '@/lib/demo';
import { appendEvent, readEvents, readState } from '@/lib/event-store';
import type { EventKind } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end();
  const context = await requireScope(req, res, true);
  if (!context) return;
  if (req.method === 'GET') {
    return res.json({
      events: await readEvents(prisma, context.scope),
      state: await readState(prisma, context.scope),
    });
  }
  // Every demo visitor is the instructor; the screens never use this raw endpoint.
  if (isDemo()) return res.status(403).json({ message: 'The demo does not accept raw events' });
  const { kind, payload, supersedesId, userId } = req.body;
  if (
    typeof kind !== 'string' ||
    (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload)))
  ) {
    return res.status(400).json({ message: 'Invalid event' });
  }
  // Exam and cold-call events change only through their own controls, which
  // validate state (the exam network, the drawn student) that this endpoint cannot.
  // That includes the check-out an Absent call writes, which carries its call's ID.
  const guarded = (value: string, data: unknown) =>
    value.startsWith('COLD_CALL') ||
    value.startsWith('EXAM_') ||
    (value === 'CHECK_OUT' && !!data && typeof data === 'object' && 'coldCallId' in data);
  if (guarded(kind, payload)) {
    return res.status(400).json({ message: 'Use the exam or cold-call controls' });
  }
  // Follow the whole chain, so an undo of an undo cannot reinstate a guarded event.
  let targetId = supersedesId === undefined || supersedesId === null ? null : String(supersedesId);
  while (targetId) {
    const target = await prisma.participationEvent.findFirst({
      where: { ...context.scope, id: targetId },
      select: { kind: true, payload: true, supersedesId: true },
    });
    if (target && guarded(target.kind, target.payload)) {
      return res.status(400).json({ message: 'Use the exam or cold-call controls' });
    }
    targetId = target?.supersedesId ?? null;
  }
  try {
    const event = await appendEvent(prisma, {
      ...context.scope,
      actorId: context.user.id,
      kind: kind as EventKind,
      payload,
      supersedesId,
      userId,
    });
    return res.status(201).json({ event });
  } catch (error) {
    return res
      .status(400)
      .json({ message: error instanceof Error ? error.message : 'Invalid event' });
  }
}
