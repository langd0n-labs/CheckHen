import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'node:crypto';
import { appendEvent, readState } from '@/lib/event-store';
import { examAgent, examDomains } from '@/lib/exam-control';
import { checkhenMode, EXAM_UNAVAILABLE } from '@/lib/mode';
import { PortalBindingError } from '@/lib/portal-binding';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }
  const context = await requireScope(req, res, true);
  if (!context) {
    return;
  }
  const { scope, user, selected } = context;
  const state = await readState(prisma, scope);
  const action = req.method === 'GET' ? 'status' : req.body?.action;
  if (checkhenMode() === 'hosted' && (action === 'start' || action === 'stop')) {
    return res.status(409).json({ message: EXAM_UNAVAILABLE });
  }
  try {
    if (action === 'start') {
      if (state.exam?.active) {
        return res.status(409).json({ message: 'Exam already active' });
      }
      if (state.endedAt || selected.createdAt.getTime() + selected.duration * 60000 <= Date.now()) {
        return res.status(400).json({ message: 'No active class' });
      }
      const domains = examDomains(req.body?.domains);
      const thresholdSeconds = Number(req.body?.thresholdSeconds ?? 30);
      // Heartbeats are 5 s apart, so a shorter limit would fail students who never left.
      if (!Number.isInteger(thresholdSeconds) || thresholdSeconds < 10 || thresholdSeconds > 3600) {
        return res.status(400).json({ message: 'The disconnect limit must be 10 to 3600 seconds' });
      }
      const clients = state.attendance
        .filter((entry) => entry.isPresent)
        .flatMap((entry) => {
          const primary = entry.devices.find((device) => device.ip === entry.deviceIp);
          return primary ? [{ userId: entry.userId, mac: primary.mac }] : [];
        });
      if (
        !clients.length ||
        clients.length !== state.attendance.filter((entry) => entry.isPresent).length
      ) {
        return res
          .status(400)
          .json({ message: 'All checked-in students need a primary AP device' });
      }
      const examId = randomUUID();
      await examAgent('exam-start', { ...scope, examId, domains, thresholdSeconds, clients });
      try {
        await appendEvent(prisma, {
          ...scope,
          actorId: user.id,
          kind: 'EXAM_STARTED',
          payload: { examId, domains, thresholdSeconds },
        });
      } catch (error) {
        await examAgent('exam-stop', scope);
        throw error;
      }
      return res.json({ examId });
    }
    if (action === 'stop') {
      if (!state.exam?.active) {
        return res.status(409).json({ message: 'No active exam' });
      }
      await examAgent('exam-stop', scope);
      await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        kind: 'EXAM_ENDED',
        payload: { examId: state.exam.id },
      });
      return res.json({ ok: true });
    }
    if (action === 'excuse') {
      const fail = state.examFails.find((entry) => entry.id === req.body?.failId && !entry.excused);
      const reason = req.body?.reason;
      if (!fail) {
        return res.status(404).json({ message: 'Active fail not found' });
      }
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
        return res.status(400).json({ message: 'Enter a reason' });
      }
      await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        userId: fail.userId,
        kind: 'EXAM_EXCUSED',
        payload: { examId: fail.examId, reason: reason.trim() },
        supersedesId: fail.id,
      });
      return res.json({ ok: true });
    }
    if (action === 'status') {
      const network = state.exam?.active
        ? await examAgent('exam-status', scope)
        : { active: false, clients: [] };
      const users = await prisma.user.findMany({
        where: { id: { in: state.attendance.map((entry) => entry.userId) } },
      });
      return res.json({
        exam: state.exam,
        fails: state.examFails,
        network,
        students: state.attendance.map((entry) => ({
          userId: entry.userId,
          name:
            users.find((candidate) => candidate.id === entry.userId)?.displayName ||
            users.find((candidate) => candidate.id === entry.userId)?.email ||
            entry.anonymousName,
        })),
      });
    }
    return res.status(400).json({ message: 'Unknown exam action' });
  } catch (error) {
    if (error instanceof PortalBindingError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error instanceof Error && /domain|allowlist/i.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    throw error;
  }
}
