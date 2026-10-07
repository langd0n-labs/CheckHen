import type { NextApiRequest, NextApiResponse } from 'next';
import { isDemo, seedDemo } from '@/lib/demo';
import { demoGate } from '@/lib/demo-guard';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';

/**
 * Demo mode, instructor only: restore the seed. The event log is append-only, so
 * this makes a new demo course; the demo always shows the newest one.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }
  if (!isDemo()) {
    return res.status(404).end();
  }
  const identity = await requireIdentity(req, res, true);
  if (!identity) {
    return;
  }
  // Each reset writes a full course, so resets have their own, tighter limit.
  if (!(await demoGate(req, res, 'reset'))) {
    return;
  }
  return res.json(await seedDemo(prisma));
}
