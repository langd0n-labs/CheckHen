import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { isDemo } from '@/lib/demo';
import { prisma } from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_BASE64_BYTES = 2.7 * 1024 * 1024; // ~2MB original image

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Demo visitors share every persona, so no one may change the demo photos.
  if (isDemo()) {
    return res.status(403).json({ message: 'Photo uploads are off in the demo' });
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64 || !imageBase64.startsWith('data:image/')) {
    return res.status(400).json({ message: 'Invalid image data' });
  }

  if (imageBase64.length > MAX_BASE64_BYTES) {
    return res.status(400).json({ message: 'Image must be under 2MB' });
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: { profilePicture: imageBase64 },
  });

  return res.status(200).json({ profilePicture: imageBase64 });
}
