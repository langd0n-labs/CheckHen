import { getServerSession } from 'next-auth';
import { authOptions } from './[...nextauth]';
import { isInstructor } from '@/lib/instructor';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ isAdmin: boolean }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ isAdmin: false });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(200).json({ isAdmin: false });
  }

  return res.status(200).json({ isAdmin: isInstructor(session.user.email) });
}
