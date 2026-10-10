import { getServerSession } from 'next-auth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { authOptions } from '../pages/api/auth/[...nextauth]';
import { demoGate, type GateOptions } from './demo-guard';
import { isInstructor } from './instructor';
import { prisma } from './prisma';

export { isInstructor };

export async function requireIdentity(req: NextApiRequest, res: NextApiResponse, adminOnly = false,
  gate: GateOptions = {}) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) { res.status(401).json({ message: 'Unauthorized' }); return null; }
  // After sign-in: an anonymous request is refused without using any demo counter.
  if (!await demoGate(req, res, gate)) return null;
  const admin = isInstructor(session.user.email);
  if (adminOnly && !admin) { res.status(403).json({ message: 'Instructor access required' }); return null; }
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) { res.status(401).json({ message: 'Unknown user' }); return null; }
  return { user, admin };
}

export async function requireScope(req: NextApiRequest, res: NextApiResponse, adminOnly = false) {
  const identity = await requireIdentity(req, res, adminOnly);
  if (!identity) return null;
  const courseId = req.query.courseId ?? req.body?.courseId;
  const classId = req.query.classId ?? req.body?.classId;
  if (typeof courseId !== 'string' || !courseId || typeof classId !== 'string' || !classId) {
    res.status(400).json({ message: 'Select a course and class session' }); return null;
  }
  const selected = await prisma.class.findFirst({ where: { id: classId, courseId } });
  if (!selected) { res.status(404).json({ message: 'Course/session not found' }); return null; }
  if (!identity.admin) {
    const roster = await prisma.rosterEntry.findUnique({
      where: { courseId_userId: { courseId, userId: identity.user.id } },
    });
    if (!roster?.active) { res.status(403).json({ message: 'Not active on this roster' }); return null; }
  }
  return { ...identity, scope: { courseId, classId }, selected };
}
