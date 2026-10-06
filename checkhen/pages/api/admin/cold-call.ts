import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  eligibility,
  OUTCOMES,
  resolveConfig,
  seededRandom,
  select,
  type ColdCallOutcome,
  type Meeting,
} from '@/lib/cold-call';
import { appendEvent, asEvent, ConflictError, readState } from '@/lib/event-store';
import { effectiveEvents, foldEvents, type EventScope } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';

type Db = PrismaClient | Prisma.TransactionClient;

/** A drawn student stays recordable for 30 minutes. */
const DRAW_LIFETIME_MS = 30 * 60 * 1000;

/** Every meeting of the course up to and including the selected session, in order. */
async function courseMeetings(db: Db, scope: EventScope) {
  const sessions = await db.class.findMany({
    where: {
      courseId: scope.courseId,
      OR: [{ createdAt: { lte: new Date() } }, { id: scope.classId }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const current = sessions.findIndex((session) => session.id === scope.classId);
  const held = sessions.slice(0, current + 1);
  const events = (
    await db.participationEvent.findMany({
      where: { courseId: scope.courseId, classId: { in: held.map((session) => session.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
  const meetings: Meeting[] = held.map((session) => ({
    courseId: scope.courseId,
    classId: session.id,
    events: events.filter((event) => event.classId === session.id),
  }));
  return { meetings, current };
}

/** Checked-in, active-roster students who may be called now. */
async function eligibleStudents(db: Db, scope: EventScope) {
  const { meetings, current } = await courseMeetings(db, scope);
  const active = new Set(
    (
      await db.rosterEntry.findMany({
        where: { courseId: scope.courseId, active: true },
        select: { userId: true },
      })
    ).map((entry) => entry.userId)
  );
  const present = foldEvents(meetings[current].events, scope)
    .attendance.filter((entry) => entry.isPresent && active.has(entry.userId))
    .map((entry) => entry.userId);
  return eligibility(meetings, current, present).filter((entry) => entry.eligible);
}

function drawSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured');
  }
  return secret;
}

/** The draw token binds a record to one draw of one student in one session. */
function signDraw(scope: EventScope, userId: string, seed: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...scope, userId, seed, issuedAt: Date.now() })
  ).toString('base64url');
  return `${body}.${createHmac('sha256', drawSecret()).update(body).digest('base64url')}`;
}

function readDraw(token: unknown, scope: EventScope) {
  if (typeof token !== 'string') {
    return null;
  }
  const [body, signature] = token.split('.');
  if (!body || !signature) {
    return null;
  }
  const expected = Buffer.from(createHmac('sha256', drawSecret()).update(body).digest('base64url'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  const draw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (
    draw.courseId !== scope.courseId ||
    draw.classId !== scope.classId ||
    typeof draw.userId !== 'string' ||
    !Number.isInteger(draw.seed) ||
    Date.now() - draw.issuedAt > DRAW_LIFETIME_MS
  ) {
    return null;
  }
  return draw as { userId: string; seed: number };
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
    const course = await prisma.course.findUnique({ where: { id: scope.courseId } });
    const candidates = await eligibleStudents(prisma, scope);
    // The seed is recorded with the outcome so a semester can be replayed exactly.
    const seed = randomInt(0, 2 ** 32);
    const selected = select(candidates, resolveConfig(course?.config), seededRandom(seed));
    if (!selected) {
      return res.status(409).json({ message: 'No eligible students' });
    }
    const student = await prisma.user.findUnique({ where: { id: selected } });
    return res.json({
      seed,
      draw: signDraw(scope, selected, seed),
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
    const { outcome } = req.body ?? {};
    const draw = readDraw(req.body?.draw, scope);
    if (!draw || !OUTCOMES.includes(outcome as ColdCallOutcome)) {
      return res.status(400).json({ message: 'Call on a student first' });
    }
    try {
      const event = await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        userId: draw.userId,
        kind: 'COLD_CALL',
        payload: { outcome, seed: draw.seed },
        // Checked inside the session lock, so two phones or a double tap cannot both record.
        guard: async (tx) => {
          const recorded = await tx.participationEvent.findMany({
            where: { ...scope, kind: 'COLD_CALL' },
            select: { payload: true },
          });
          if (recorded.some((event) => (event.payload as { seed?: number }).seed === draw.seed)) {
            throw new ConflictError('This call is already recorded');
          }
          if (!(await eligibleStudents(tx, scope)).some((entry) => entry.userId === draw.userId)) {
            throw new ConflictError('This student can no longer be called');
          }
        },
      });
      return res.json({ id: event.id });
    } catch (error) {
      if (error instanceof ConflictError) {
        return res.status(409).json({ message: error.message });
      }
      throw error;
    }
  }

  if (action === 'undo') {
    const target = await prisma.participationEvent.findFirst({
      where: { ...scope, id: String(req.body?.eventId ?? ''), kind: 'COLD_CALL' },
    });
    if (!target) {
      return res.status(404).json({ message: 'Call not found' });
    }
    try {
      await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        userId: target.userId,
        kind: 'UNDO',
        supersedesId: target.id,
        guard: async (tx) => {
          if (
            await tx.participationEvent.findFirst({ where: { ...scope, supersedesId: target.id } })
          ) {
            throw new ConflictError('Call already undone');
          }
        },
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        return res.status(409).json({ message: error.message });
      }
      throw error;
    }
    return res.json({ ok: true });
  }

  return res.status(400).json({ message: 'Unknown cold-call action' });
}
