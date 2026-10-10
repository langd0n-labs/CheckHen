import type { NextApiRequest, NextApiResponse } from 'next';
import { requireIdentity } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  if (!(await requireIdentity(req, res, true))) return;

  const { email } = req.query;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'Missing email parameter' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      profilePicture: true,
      foodAllergies: true,
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
    foodAllergies: user.foodAllergies ?? null,
    displayName: user.displayName ?? null,
    namePronunciation: user.namePronunciation ?? null,
    pronouns: user.pronouns ?? null,
    bio: user.bio ?? null,
  });
}
