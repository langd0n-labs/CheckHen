import type { NextApiRequest, NextApiResponse } from 'next';
import { currentDemoCourse, isDemo } from '@/lib/demo';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end();
  const identity = await requireIdentity(req, res, req.method === 'POST');
  if (!identity) return;
  if (req.method === 'GET') {
    // A demo deployment shows only the current demo course; earlier resets stay hidden.
    if (isDemo()) {
      const course = await currentDemoCourse(prisma);
      return res.json({ courses: course ? [course] : [] });
    }
    const courses = await prisma.course.findMany({
      where: identity.admin ? {} : { roster: { some: { userId: identity.user.id, active: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return res.json({ courses });
  }
  // The demo course comes only from the seed; visitors cannot add courses.
  if (isDemo()) return res.status(403).json({ message: 'The demo cannot add courses' });
  const name = req.body?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 200)
    return res.status(400).json({ message: 'Invalid course name' });
  return res
    .status(201)
    .json({ course: await prisma.course.create({ data: { name: name.trim() } }) });
}
