import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { demoGate } from '@/lib/demo-guard';
import { prisma } from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_FIELD: Record<string, number> = {
  foodAllergies: 200,
  displayName: 80,
  namePronunciation: 80,
  pronouns: 40,
};
const LABEL: Record<string, string> = {
  foodAllergies: 'Food allergies',
  displayName: 'Display name',
  namePronunciation: 'Pronunciation',
  pronouns: 'Pronouns',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  // After sign-in: an anonymous request is refused without using any demo counter.
  if (!(await demoGate(req, res))) {
    return;
  }

  const { foodAllergies, displayName, namePronunciation, pronouns, bio } = req.body as {
    foodAllergies?: string | null;
    displayName?: string | null;
    namePronunciation?: string | null;
    pronouns?: string | null;
    bio?: string | null;
  };

  if (bio && bio.length > 280) {
    return res.status(400).json({ message: 'Bio must be 280 characters or fewer' });
  }
  const fields = { foodAllergies, displayName, namePronunciation, pronouns };
  for (const [field, value] of Object.entries(fields)) {
    if (value != null && (typeof value !== 'string' || value.length > MAX_FIELD[field])) {
      return res
        .status(400)
        .json({ message: `${LABEL[field]} must be ${MAX_FIELD[field]} characters or fewer` });
    }
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      foodAllergies: foodAllergies ?? null,
      displayName: displayName || null,
      namePronunciation: namePronunciation || null,
      pronouns: pronouns || null,
      bio: bio || null,
    },
  });

  return res.status(200).json({ message: 'Profile updated' });
}
