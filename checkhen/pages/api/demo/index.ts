import type { NextApiRequest, NextApiResponse } from 'next';
import {
  avatar,
  currentDemoCourse,
  DEMO_INSTRUCTOR_PERSONA,
  DEMO_STUDENTS,
  isDemo,
  seedDemo,
} from '@/lib/demo';
import { demoGate } from '@/lib/demo-guard';
import { prisma } from '@/lib/prisma';

/** Demo mode only: the personas to sign in as, and the demo course to open. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }
  if (!isDemo()) {
    return res.status(404).end();
  }
  if (!(await demoGate(req, res))) {
    return;
  }
  let course = await currentDemoCourse(prisma);
  if (!course) {
    // First visit to a fresh demo deployment: seed it.
    await seedDemo(prisma);
    course = await currentDemoCourse(prisma);
  }
  const live = await prisma.class.findFirst({
    where: { courseId: course!.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const persona = (entry: typeof DEMO_INSTRUCTOR_PERSONA, role: 'instructor' | 'student') => ({
    email: entry.email,
    name: entry.name,
    note: entry.note,
    photo: avatar(entry),
    role,
  });
  return res.json({
    courseId: course!.id,
    liveClassId: live?.id ?? null,
    personas: [
      persona(DEMO_INSTRUCTOR_PERSONA, 'instructor'),
      ...DEMO_STUDENTS.map((student) => persona(student, 'student')),
    ],
  });
}
