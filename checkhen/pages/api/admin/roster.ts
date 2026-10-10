import type { NextApiRequest, NextApiResponse } from 'next';
import { DEMO_DOMAIN, isDemo } from '@/lib/demo';
import { requireIdentity } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end();
  if (!await requireIdentity(req, res, true)) return;
  const courseId = req.query.courseId ?? req.body?.courseId;
  if (typeof courseId !== 'string' || !await prisma.course.findUnique({ where: { id: courseId } })) {
    return res.status(404).json({ message: 'Course not found' });
  }
  if (req.method === 'GET') {
    return res.json({ roster: await prisma.rosterEntry.findMany({ where: { courseId }, include: { user: true }, orderBy: { userId: 'asc' } }) });
  }
  const { email, active = true } = req.body;
  // A public demo holds only fictional addresses, never a real student's.
  const domain = isDemo() ? DEMO_DOMAIN : process.env.NEXT_PUBLIC_EMAIL_DOMAIN || 'bu.edu';
  if (typeof email !== 'string' || email.length > 254 || !email.endsWith('@' + domain) ||
      typeof active !== 'boolean') {
    return res.status(400).json({ message: 'Invalid roster entry' });
  }
  const user = await prisma.user.upsert({ where: { email }, create: { email }, update: {} });
  const entry = await prisma.rosterEntry.upsert({
    where: { courseId_userId: { courseId, userId: user.id } },
    create: { courseId, userId: user.id, active }, update: { active },
  });
  return res.json({ entry });
}
