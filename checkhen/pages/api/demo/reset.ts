import type { NextApiRequest, NextApiResponse } from 'next';
import { currentDemoCourse, isDemo, seedDemo } from '@/lib/demo';
import { stopChatter } from '@/lib/demo-chatter';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';

/**
 * Demo mode, instructor only: restore the seed. The event log is append-only, so
 * this makes a new demo course; the demo always shows the newest one.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }
  if (!isDemo()) {
    return res.status(404).end();
  }
  // Each reset writes a full course, so resets have their own, tighter limit. A reset
  // is small, so it still runs when the database has reached the size cap.
  const identity = await requireIdentity(req, res, true, { bucket: 'reset', pastSizeCap: true });
  if (!identity) {
    return;
  }
  // The old demo course is set aside: end its open sessions and its simulated chat, so
  // nothing keeps running against it.
  stopChatter();
  const previous = await currentDemoCourse(prisma);
  if (previous) {
    for (const session of await prisma.class.findMany({ where: { courseId: previous.id } })) {
      const scope = { courseId: previous.id, classId: session.id };
      if (!(await readState(prisma, scope)).endedAt) {
        await appendEvent(prisma, {
          ...scope,
          actorId: identity.user.id,
          kind: 'SESSION_ENDED',
          payload: {},
        });
      }
    }
  }
  return res.json(await seedDemo(prisma));
}
