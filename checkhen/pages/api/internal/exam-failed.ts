import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readState } from '@/lib/event-store';
import { recordExamFail } from '@/lib/exam-control';
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
  const { userId, courseId, classId, examId, failId, timestamp, action } = body;
  // The signed action stops a body signed for another agent call from being replayed here.
  if (action !== 'exam-failed') {
    return res.status(403).end();
  }
  if (
    [userId, courseId, classId, examId, failId].some(
      (value) => typeof value !== 'string' || !value
    ) ||
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
  // Each drop has its own failId, so a student excused once can fail again.
  await recordExamFail(scope, {
    examId: examId as string,
    userId: userId as string,
    failId: failId as string,
  });
  return res.status(200).json({ ok: true });
}
