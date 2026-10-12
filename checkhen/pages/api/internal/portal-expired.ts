import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { appendEvent, readState } from '@/lib/event-store';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.PORTAL_CONTROL_SECRET;
  const signature = req.headers['x-checkhen-signature'];
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks);
  if (!secret || typeof signature !== 'string') return res.status(403).end();
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return res.status(403).end();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
  const { userId, courseId, classId, timestamp, action } = body;
  // The signed action stops a body signed for another agent call from being replayed here.
  if (action !== 'portal-expired') return res.status(403).end();
  if (typeof userId !== 'string' || !userId || typeof courseId !== 'string' || !courseId ||
      typeof classId !== 'string' || !classId ||
      typeof timestamp !== 'number' || Math.abs(Date.now() - timestamp) > 30000) return res.status(403).end();
  const scope = { courseId, classId };
  const state = await readState(prisma, scope);
  if (state.attendance.some(entry => entry.userId === userId && entry.isPresent)) {
    await appendEvent(prisma, { ...scope, actorId: 'system:lease-expiry', userId,
      kind: 'CHECK_OUT' });
  }
  return res.status(200).json({ ok: true });
}
