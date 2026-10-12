import type { NextApiRequest, NextApiResponse } from 'next';
import { currentDemoCourse, isDemo } from '@/lib/demo';
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
  // Only the demo's own live session: the newest session of the current demo course.
  const course = await currentDemoCourse(prisma);
  const live = course
    ? await prisma.class.findFirst({
        where: { courseId: course.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    : null;
  if (!live || live.id !== scope.classId || course!.id !== scope.courseId) {
    return res.status(409).json({ message: 'Simulated chat runs only in the live demo session' });
  }
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
