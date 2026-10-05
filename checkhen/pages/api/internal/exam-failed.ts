import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }
  const secret = process.env.PORTAL_CONTROL_SECRET;
  const signature = req.headers['x-checkhen-signature'];
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  if (!secret || typeof signature !== 'string') {
    return res.status(403).end();
  }
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return res.status(403).end();
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  const { userId, courseId, classId, examId, timestamp } = body;
  if (
    [userId, courseId, classId, examId].some((value) => typeof value !== 'string' || !value) ||
    typeof timestamp !== 'number' ||
    Math.abs(Date.now() - timestamp) > 30000
  ) {
    return res.status(403).end();
  }
  const scope = { courseId: courseId as string, classId: classId as string };
  const state = await readState(prisma, scope);
  if (!state.exam) {
    return res.status(503).end();
  }
  if (
    !state.exam.active ||
    state.exam.id !== examId ||
    !state.attendance.some((entry) => entry.userId === userId) ||
    state.examFails.some((entry) => entry.userId === userId)
  ) {
    return res.status(200).json({ ok: true });
  }
  await appendEvent(prisma, {
    ...scope,
    actorId: 'system:exam-monitor',
    userId: userId as string,
    kind: 'EXAM_FAILED',
    payload: { examId: examId as string },
  });
  return res.status(200).json({ ok: true });
}
