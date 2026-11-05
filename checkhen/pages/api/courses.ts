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
      const role = identity.deploymentInstructor ? 'instructor' : 'student';
      return res.json({ courses: course ? [{ ...course, role }] : [], canCreate: false });
    }
    const courses = await prisma.course.findMany({
      where: identity.deploymentInstructor
        ? {}
        : {
            OR: [
              { roster: { some: { userId: identity.user.id, active: true } } },
              { staff: { some: { userId: identity.user.id } } },
            ],
          },
      include: { staff: { where: { userId: identity.user.id }, select: { userId: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    // Each course says whether the caller instructs it or takes it.
    return res.json({
      courses: courses.map(({ staff, ...course }) => ({
        ...course,
        role: identity.deploymentInstructor || staff.length ? 'instructor' : 'student',
      })),
      canCreate: identity.deploymentInstructor,
    });
  }
  // The demo course comes only from the seed; visitors cannot add courses.
  if (isDemo()) return res.status(403).json({ message: 'The demo cannot add courses' });
  // Course staff instruct their own courses; only a deployment instructor adds one.
  if (!identity.deploymentInstructor)
    return res.status(403).json({ message: 'Only a deployment instructor adds courses' });
  const name = req.body?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 200)
    return res.status(400).json({ message: 'Invalid course name' });
  return res
    .status(201)
    .json({ course: await prisma.course.create({ data: { name: name.trim() } }) });
}
