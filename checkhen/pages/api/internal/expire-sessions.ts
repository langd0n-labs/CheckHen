import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { expireSessions } from '@/lib/session-expiry';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  const secret = process.env.AUTH_SECRET;
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
  const signature = req.headers['x-checkhen-signature'];
  if (!secret || typeof signature !== 'string') return res.status(403).end();
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const received = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (received.length !== target.length || !timingSafeEqual(received, target)) return res.status(403).end();
  const timestamp = req.body?.timestamp;
  if (typeof timestamp !== 'number') return res.status(400).end();
  if (Math.abs(Date.now() - timestamp) > 30000) return res.status(403).end();
  try {
    return res.status(200).json({ ended: await expireSessions() });
  } catch {
    return res.status(503).json({ message: 'Session expiry will retry' });
  }
}
