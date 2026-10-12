import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
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
    profilePicture: user.profilePicture ?? null,
    foodAllergies: user.foodAllergies ?? null,
    displayName: user.displayName ?? null,
    namePronunciation: user.namePronunciation ?? null,
    pronouns: user.pronouns ?? null,
    bio: user.bio ?? null,
  });
}
