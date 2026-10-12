import type { NextApiRequest, NextApiResponse } from 'next';
import { requireScope } from '@/lib/request-scope';
import { readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';

// Compatibility route: returns the explicitly selected session, never the latest.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const context = await requireScope(req, res);
  if (!context) return;
  const { endedAt } = await readState(prisma, context.scope);
  const selected = { ...context.selected, ...(endedAt ? {
    duration: (endedAt.getTime() - context.selected.createdAt.getTime()) / 60000,
  } : {}) };
  return res.json({ message: JSON.stringify(selected) });
}
