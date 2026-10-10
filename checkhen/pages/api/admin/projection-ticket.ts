import type { NextApiRequest, NextApiResponse } from 'next';
import { requireScope } from '@/lib/request-scope';
import { mintProjectionTicket } from '@/lib/projection-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const context = await requireScope(req, res, true);
  if (!context) return;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return res.status(503).json({ message: 'Server authentication is not configured' });
  const end = context.selected.createdAt.getTime() + context.selected.duration * 60000;
  if (end <= Date.now()) return res.status(400).json({ message: 'Class has ended' });
  const expires = Math.min(end, Date.now() + 4 * 60 * 60 * 1000);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ticket: mintProjectionTicket(context.scope, expires, secret), expires });
}
