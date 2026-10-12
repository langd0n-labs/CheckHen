import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { isInstructor } from '@/lib/instructor';
import { prisma } from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

// Define a user structure compatible with the frontend expectations
type UserInfo = {
  id: string;
  emailAddresses: Array<{ emailAddress: string }>;
};

// Define the structure of the response data
type ResponseData = {
  message: string;
  user?: UserInfo;
};

// API handler function to fetch user information from Auth.js session
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  // Allow only GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Get the authenticated session
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const email = session.user.email;

  // Fetch or create user in the database by email
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      isAdmin: isInstructor(email),
    },
  });

  // Return user information in a format compatible with the frontend
  const userInfo: UserInfo = {
    id: user.email, // Use email as the ID
    emailAddresses: [{ emailAddress: user.email }],
  };

  res.status(200).json({ message: 'Success', user: userInfo });
}