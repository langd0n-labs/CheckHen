import type { NextApiRequest, NextApiResponse } from 'next';
import { requireIdentity } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const identity = await requireIdentity(req, res, true);
  if (!identity) return;

  const { email, courseId } = req.query;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'Missing email parameter' });
  }
  // Course staff see only the students of the course they instruct.
  if (
    !identity.deploymentInstructor &&
    !(await prisma.rosterEntry.findFirst({ where: { courseId: String(courseId), user: { email } } }))
  ) {
    return res.status(404).json({ message: 'User not found' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      profilePicture: true,
      name: true,
      displayName: true,
      namePronunciation: true,
      pronouns: true,
      bio: true,
    },
  });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  return res.status(200).json({
    email: user.email,
    profilePicture: user.profilePicture ?? null,
    name: user.name ?? null,
    displayName: user.displayName ?? null,
    namePronunciation: user.namePronunciation ?? null,
    pronouns: user.pronouns ?? null,
    bio: user.bio ?? null,
  });
}
