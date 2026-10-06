import type { NextApiRequest, NextApiResponse } from 'next';
import { randomInt } from 'node:crypto';
import {
  eligibility,
  OUTCOMES,
  resolveConfig,
  seededRandom,
  select,
  type ColdCallOutcome,
  type Meeting,
} from '@/lib/cold-call';
import { appendEvent, asEvent, readState } from '@/lib/event-store';
import { effectiveEvents } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';

/** Every meeting of the course up to and including the selected session, in order. */
async function courseMeetings(courseId: string, classId: string) {
  const sessions = await prisma.class.findMany({
    where: { courseId, OR: [{ createdAt: { lte: new Date() } }, { id: classId }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const current = sessions.findIndex((session) => session.id === classId);
  const events = (
    await prisma.participationEvent.findMany({
      where: { courseId, classId: { in: sessions.slice(0, current + 1).map((s) => s.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
  const meetings: Meeting[] = sessions.slice(0, current + 1).map((session) => ({
    courseId,
    classId: session.id,
    events: events.filter((event) => event.classId === session.id),
  }));
  return { meetings, current };
}

const studentName = (user: { displayName: string | null; email: string }) =>
  user.displayName || user.email.split('@')[0];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }
  const context = await requireScope(req, res, true);
  if (!context) {
    return;
  }
  const { scope, user } = context;
  const action = req.method === 'GET' ? 'status' : req.body?.action;
  const course = await prisma.course.findUnique({ where: { id: scope.courseId } });
  const config = resolveConfig(course?.config);

  if (action === 'status') {
    const state = await readState(prisma, scope);
    const events = await prisma.participationEvent.findMany({
      where: { ...scope, kind: { in: ['COLD_CALL', 'UNDO'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const calls = effectiveEvents(events.map(asEvent), scope).filter(
      (event) => event.kind === 'COLD_CALL'
    );
    const users = await prisma.user.findMany({
      where: { id: { in: calls.map((call) => call.userId!) } },
      select: { id: true, displayName: true, email: true },
    });
    return res.json({
      present: state.attendance.filter((entry) => entry.isPresent).length,
      calls: calls.map((call) => {
        const student = users.find((candidate) => candidate.id === call.userId);
        return {
          id: call.id,
          userId: call.userId,
          name: student ? studentName(student) : call.userId,
          outcome: call.payload.outcome,
          createdAt: call.createdAt,
        };
      }),
    });
  }

  if (action === 'draw') {
    const state = await readState(prisma, scope);
    const active = new Set(
      (
        await prisma.rosterEntry.findMany({
          where: { courseId: scope.courseId, active: true },
          select: { userId: true },
        })
      ).map((entry) => entry.userId)
    );
    const present = state.attendance
      .filter((entry) => entry.isPresent && active.has(entry.userId))
      .map((entry) => entry.userId);
    const { meetings, current } = await courseMeetings(scope.courseId, scope.classId);
    const candidates = eligibility(meetings, current, present).filter((entry) => entry.eligible);
    // The seed is recorded with the outcome so a semester can be replayed exactly.
    const seed = randomInt(0, 2 ** 32);
    const selected = select(candidates, config, seededRandom(seed));
    if (!selected) {
      return res.status(409).json({ message: 'No eligible students' });
    }
    const student = await prisma.user.findUnique({ where: { id: selected } });
    return res.json({
      seed,
      eligible: candidates.length,
      student: {
        userId: selected,
        name: student ? studentName(student) : selected,
        pronunciation: student?.namePronunciation ?? null,
        pronouns: student?.pronouns ?? null,
        photo: student?.profilePicture ?? null,
      },
    });
  }

  if (action === 'record') {
    const { userId, outcome, seed } = req.body ?? {};
    if (typeof userId !== 'string' || !OUTCOMES.includes(outcome as ColdCallOutcome)) {
      return res.status(400).json({ message: 'Choose a student and an outcome' });
    }
    try {
      const event = await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        userId,
        kind: 'COLD_CALL',
        payload: { outcome, ...(Number.isInteger(seed) ? { seed } : {}) },
      });
      return res.json({ id: event.id });
    } catch (error) {
      return res
        .status(400)
        .json({ message: error instanceof Error ? error.message : 'Invalid call' });
    }
  }

  if (action === 'undo') {
    const target = await prisma.participationEvent.findFirst({
      where: { ...scope, id: String(req.body?.eventId ?? ''), kind: 'COLD_CALL' },
    });
    if (!target) {
      return res.status(404).json({ message: 'Call not found' });
    }
    // Undo never expires; a second undo of the same call is harmless but refused.
    const undone = await prisma.participationEvent.findFirst({
      where: { ...scope, supersedesId: target.id },
    });
    if (undone) {
      return res.status(409).json({ message: 'Call already undone' });
    }
    await appendEvent(prisma, {
      ...scope,
      actorId: user.id,
      userId: target.userId,
      kind: 'UNDO',
      supersedesId: target.id,
    });
    return res.json({ ok: true });
  }

  return res.status(400).json({ message: 'Unknown cold-call action' });
}
