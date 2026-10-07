import type { NextApiRequest, NextApiResponse } from 'next';
import { demoDatabaseProblem, isDemo } from './demo';
import { prisma } from './prisma';

/**
 * Checks every demo request before a route runs. Outside demo mode it allows
 * everything. Returns false after it has sent the refusal.
 */
export async function demoGate(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (!isDemo()) {
    return true;
  }
  const problem = await demoDatabaseProblem(prisma);
  if (problem) {
    res.status(503).json({ message: problem });
    return false;
  }
  return true;
}
