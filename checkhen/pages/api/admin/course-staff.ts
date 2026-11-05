import { primaryName } from '@/lib/name-label';
import type { NextApiRequest, NextApiResponse } from 'next';
import { isDemo } from '@/lib/demo';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';

const ROLES = ['instructor', 'ta'];

/**
 * A course's staff. Its instructors and TAs may read the list; only a deployment
 * instructor (ADMIN_EMAILS) adds or removes staff.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) return res.status(405).end();
  const identity = await requireIdentity(req, res, true);
  if (!identity) return;
  const courseId = req.query.courseId ?? req.body?.courseId;
  if (
    typeof courseId !== 'string' ||
    !(await prisma.course.findUnique({ where: { id: courseId } }))
  )
    return res.status(404).json({ message: 'Course not found' });
  if (req.method === 'GET') {
    const staff = await prisma.courseStaff.findMany({
      where: { courseId },
      include: { user: { select: { email: true, name: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({
      staff: staff.map((entry) => ({
        email: entry.user.email,
        name: primaryName(entry.user),
        nickname: entry.user.displayName,
        role: entry.role,
      })),
      canManage: identity.deploymentInstructor && !isDemo(),
    });
  }
  if (!identity.deploymentInstructor || isDemo())
    return res.status(403).json({ message: 'Only a deployment instructor changes course staff' });
  const domain = (process.env.NEXT_PUBLIC_EMAIL_DOMAIN || 'bu.edu').toLowerCase();
  const raw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const email = raw && !raw.includes('@') ? `${raw}@${domain}` : raw;
  if (!email || email.length > 254 || !email.endsWith(`@${domain}`))
    return res.status(400).json({ message: `Give a ${domain} address or username` });
  if (req.method === 'DELETE') {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await prisma.courseStaff.deleteMany({ where: { courseId, userId: user.id } });
    return res.json({ message: 'Removed from course staff' });
  }
  const role = req.body?.role ?? 'instructor';
  if (!ROLES.includes(role))
    return res.status(400).json({ message: 'Role must be instructor or ta' });
  const user = await prisma.user.upsert({ where: { email }, create: { email }, update: {} });
  await prisma.courseStaff.upsert({
    where: { courseId_userId: { courseId, userId: user.id } },
    create: { courseId, userId: user.id, role },
    update: { role },
  });
  return res.json({ message: 'Added to course staff' });
}
