import type { NextApiRequest, NextApiResponse } from 'next';
import { requireIdentity } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';
import { readState } from '@/lib/event-store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const courseId = req.query.courseId;
  if (typeof courseId !== 'string') return res.status(400).json({ message: 'Select a course' });
  if (!identity.admin && !await prisma.rosterEntry.findFirst({ where: { courseId, userId: identity.user.id, active: true } })) {
    return res.status(403).json({ message: 'Not on this roster' });
  }
  const classes = await prisma.class.findMany({ where: { courseId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  const sessions = await Promise.all(classes.map(async cls => {
    const state = await readState(prisma, { courseId, classId: cls.id });
    return { ...cls, endedAt: state.endedAt, active: !state.endedAt && cls.createdAt.getTime() + cls.duration * 60000 > Date.now() };
  }));
  return res.json({ sessions });
}
