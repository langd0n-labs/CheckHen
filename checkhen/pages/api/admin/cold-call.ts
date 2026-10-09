import type { NextApiRequest, NextApiResponse } from 'next';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { generateAnonymousName } from '@/lib/anonymousNames';
import {
  courseConfig,
  eligibility,
  FOLLOW_UP_OUTCOMES,
  OUTCOMES,
  seededRandom,
  select,
  type ColdCallOutcome,
  type Meeting,
} from '@/lib/cold-call';
import {
  appendEvent,
  asEvent,
  ConflictError,
  isEffective,
  readEvents,
  readState,
} from '@/lib/event-store';
import { effectiveEvents, foldEvents, type EventScope } from '@/lib/events';
import { checkhenMode } from '@/lib/mode';
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
/**
 * Students who may be called now. With `requirePresent` false (an Absent), a
 * student who checked in this session but has since checked out still counts.
 * An ended session has no one to call.
 */
async function eligibleStudents(db: Db, scope: EventScope, requirePresent = true) {
  const { meetings, current } = await courseMeetings(db, scope);
  const active = new Set(
    (
      await db.rosterEntry.findMany({
        where: { courseId: scope.courseId, active: true },
        select: { userId: true },
      })
    ).map((entry) => entry.userId)
  );
  const state = foldEvents(meetings[current].events, scope);
  if (state.endedAt) {
    return [];
  }
  const present = state.attendance
    .filter((entry) => (entry.isPresent || !requirePresent) && active.has(entry.userId))
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

type Token =
  | { kind: 'draw'; userId: string; seed: number }
  | { kind: 'follow-up'; userId: string; callId: string };

/**
 * A draw token binds a record to one draw of one student in one session. A
 * follow-up token binds the next question to the call it follows.
 */
function sign(scope: EventScope, token: Token): string {
  const body = Buffer.from(JSON.stringify({ ...scope, ...token, issuedAt: Date.now() })).toString(
    'base64url'
  );
  return `${body}.${createHmac('sha256', drawSecret()).update(body).digest('base64url')}`;
}

function readToken(token: unknown, scope: EventScope): Token | null {
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
  const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (
    value.courseId !== scope.courseId ||
    value.classId !== scope.classId ||
    typeof value.userId !== 'string' ||
    !(Date.now() - value.issuedAt <= DRAW_LIFETIME_MS)
  ) {
    return null;
  }
  if (value.kind === 'draw' && Number.isInteger(value.seed)) {
    return { kind: 'draw', userId: value.userId, seed: value.seed };
  }
  if (value.kind === 'follow-up' && typeof value.callId === 'string') {
    return { kind: 'follow-up', userId: value.userId, callId: value.callId };
  }
  return null;
}

/** Refuse a draw token unless it is the session's latest, unused draw of an eligible student. */
async function checkDraw(
  tx: Prisma.TransactionClient,
  scope: EventScope,
  seed: number,
  userId: string,
  outcome: ColdCallOutcome
) {
  const latest = await tx.participationEvent.findFirst({
    where: { ...scope, kind: 'COLD_CALL_DRAWN' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  // A token issued before draws were recorded has no draw event to match.
  if (!latest) {
    throw new ConflictError('This draw is no longer valid. Call on someone again.');
  }
  if (
    (latest?.payload as { seed?: number } | undefined)?.seed !== seed ||
    latest?.userId !== userId
  ) {
    throw new ConflictError('A newer draw replaced this one');
  }
  // Only a call still in force uses up the draw: after an undo, the instructor
  // may record the corrected outcome for the same draw.
  const events = (
    await tx.participationEvent.findMany({
      where: scope,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
  // A call stays recorded when an excuse supersedes it; only an undo frees the draw.
  const effective = effectiveEvents(events, scope);
  const excused = new Set(
    effective
      .filter((event) => event.kind === 'COLD_CALL_EXCUSED')
      .map((event) => event.supersedesId)
  );
  if (
    events.some(
      (event) =>
        event.kind === 'COLD_CALL' &&
        event.payload.seed === seed &&
        (excused.has(event.id) || effective.some((current) => current.id === event.id))
    )
  ) {
    throw new ConflictError('This call is already recorded');
  }
  // Session end checks everyone out, so other outcomes are already refused for
  // presence; an Absent, which skips presence, is refused here.
  if (outcome === 'absent' && foldEvents(events, scope).endedAt) {
    throw new ConflictError('This class session has ended');
  }
  // An absence stands even if the student already checked out; every other
  // eligibility rule (roster, session) still applies.
  if (
    !(await eligibleStudents(tx, scope, outcome !== 'absent')).some(
      (entry) => entry.userId === userId
    )
  ) {
    throw new ConflictError('This student can no longer be called');
  }
}

/** Refuse a follow-up unless its call is still the latest call and no draw came after it. */
async function checkFollowUp(tx: Prisma.TransactionClient, scope: EventScope, callId: string) {
  // Read every kind: an UNDO may target any event, and supersession needs its target.
  const events = (
    await tx.participationEvent.findMany({
      where: scope,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
  const latest = effectiveEvents(events, scope)
    .filter((event) => event.kind === 'COLD_CALL' || event.kind === 'COLD_CALL_DRAWN')
    .at(-1);
  if (latest?.id !== callId) {
    throw new ConflictError('This follow-up is no longer current');
  }
}

/** True when the student's attendance in this session is current. */
async function isPresent(tx: Prisma.TransactionClient, scope: EventScope, userId: string) {
  const events = (
    await tx.participationEvent.findMany({
      where: scope,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
  return foldEvents(events, scope).attendance.some(
    (entry) => entry.userId === userId && entry.isPresent
  );
}

/** The check-out an Absent call wrote, if it is still in force. */
async function linkedCheckOut(
  tx: Prisma.TransactionClient,
  scope: EventScope,
  call: { id: string; userId: string | null; actorId: string }
) {
  const checkOuts = await tx.participationEvent.findMany({
    where: { ...scope, kind: 'CHECK_OUT', userId: call.userId, actorId: call.actorId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const linked = checkOuts.find(
    (event) => (event.payload as { coldCallId?: string }).coldCallId === call.id
  );
  if (!linked || !(await isEffective(tx, scope, linked.id))) {
    return null;
  }
  return linked;
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

  // Hosted mode has no network attendance: the instructor takes roll call instead.
  if (action === 'roll-call' || action === 'mark') {
    if (checkhenMode() !== 'hosted') {
      return res
        .status(409)
        .json({ message: 'Roll call is for hosted mode; the access point takes attendance here' });
    }
    if (action === 'mark') {
      const { userId, present } = req.body ?? {};
      if (typeof userId !== 'string' || typeof present !== 'boolean') {
        return res.status(400).json({ message: 'Choose a student and present or absent' });
      }
      // Roll call lists only active students; a removed student cannot be marked.
      const entry = await prisma.rosterEntry.findUnique({
        where: { courseId_userId: { courseId: scope.courseId, userId } },
      });
      if (!entry?.active) {
        return res.status(400).json({ message: 'That student is not active on this roster' });
      }
      const current = (await readState(prisma, scope)).attendance.find(
        (entry) => entry.userId === userId
      );
      try {
        if (present && !current?.isPresent) {
          // The same check-in event network attendance writes; the store keeps the
          // anonymous name unique within the session.
          await appendEvent(prisma, {
            ...scope,
            actorId: user.id,
            userId,
            kind: 'CHECK_IN',
            payload: { anonymousName: generateAnonymousName(), rollCall: true },
          });
        } else if (!present && current?.isPresent) {
          // A roll-call Absent corrects a roll-call Present: undo the check-in, so the
          // course record does not count the session as attended. A student who
          // checked in on their own is checked out instead.
          const checkIns = effectiveEvents(await readEvents(prisma, scope), scope).filter(
            (event) => event.kind === 'CHECK_IN' && event.userId === userId
          );
          if (checkIns.length && checkIns.every((event) => event.payload.rollCall === true)) {
            const [first, ...rest] = checkIns.map((event) => ({
              ...scope,
              actorId: user.id,
              userId,
              kind: 'UNDO' as const,
              payload: { rollCall: true },
              supersedesId: event.id,
            }));
            await appendEvent(prisma, { ...first, alsoWrite: async () => rest });
          } else {
            await appendEvent(prisma, {
              ...scope,
              actorId: user.id,
              userId,
              kind: 'CHECK_OUT',
              payload: { rollCall: true },
            });
          }
        }
      } catch (error) {
        return res
          .status(400)
          .json({ message: error instanceof Error ? error.message : 'Could not record' });
      }
    }
    const state = await readState(prisma, scope);
    const roster = await prisma.rosterEntry.findMany({
      where: { courseId: scope.courseId, active: true },
      include: { user: true },
    });
    return res.json({
      students: roster
        .map((entry) => ({
          userId: entry.userId,
          name: studentName(entry.user),
          pronunciation: entry.user.namePronunciation,
          photo: entry.user.profilePicture,
          present: state.attendance.some(
            (attendee) => attendee.userId === entry.userId && attendee.isPresent
          ),
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId)),
    });
  }

  if (action === 'status') {
    const state = await readState(prisma, scope);
    // Read every kind: an UNDO may target any event, and supersession needs its target.
    const events = await prisma.participationEvent.findMany({
      where: scope,
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
      // Set when saved grade settings are invalid and some defaults are in use.
      configProblem: courseConfig(
        (await prisma.course.findUnique({ where: { id: scope.courseId } }))?.config
      ).problem,
      calls: calls.map((call) => {
        const student = users.find((candidate) => candidate.id === call.userId);
        return {
          id: call.id,
          userId: call.userId,
          name: student ? studentName(student) : call.userId,
          outcome: call.payload.outcome,
          followUp: typeof call.payload.followUpOf === 'string',
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
    const selected = select(candidates, courseConfig(course?.config).config, seededRandom(seed));
    if (!selected) {
      return res.status(409).json({ message: 'No eligible students' });
    }
    // The latest draw is authoritative: recording any earlier draw's token is refused.
    await appendEvent(prisma, {
      ...scope,
      actorId: user.id,
      userId: selected,
      kind: 'COLD_CALL_DRAWN',
      payload: { seed },
    });
    const student = await prisma.user.findUnique({ where: { id: selected } });
    return res.json({
      seed,
      draw: sign(scope, { kind: 'draw', userId: selected, seed }),
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
    const token = readToken(req.body?.draw ?? req.body?.followUp, scope);
    const allowed = token?.kind === 'follow-up' ? FOLLOW_UP_OUTCOMES : OUTCOMES;
    if (!token || !allowed.includes(outcome as ColdCallOutcome)) {
      return res.status(400).json({ message: 'Call on a student first' });
    }
    try {
      const event = await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        userId: token.userId,
        kind: 'COLD_CALL',
        payload:
          token.kind === 'draw'
            ? { outcome, seed: token.seed }
            : { outcome, followUpOf: token.callId },
        // Checked inside the session lock, so two phones or a double tap cannot both record.
        guard: (tx) =>
          token.kind === 'draw'
            ? checkDraw(tx, scope, token.seed, token.userId, outcome)
            : checkFollowUp(tx, scope, token.callId),
        // Absent means the student left early: check them out in the same transaction.
        alsoWrite: async (tx, call) =>
          outcome === 'absent' && (await isPresent(tx, scope, call.userId!))
            ? [
                {
                  ...scope,
                  actorId: user.id,
                  userId: call.userId,
                  kind: 'CHECK_OUT',
                  // Undoing the Absent call also undoes this check-out.
                  payload: { coldCallId: call.id },
                },
              ]
            : [],
      });
      // Every Answered can lead to a follow-up, so a plain Answered tapped by mistake
      // can still start one from the result line.
      const followUp =
        outcome === 'answered'
          ? sign(scope, { kind: 'follow-up', userId: token.userId, callId: event.id })
          : undefined;
      return res.json({ id: event.id, followUp });
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
          if (!(await isEffective(tx, scope, target.id))) {
            throw new ConflictError('Call already undone or excused');
          }
        },
        // A mistaken Absent must not leave the student checked out: undo both together.
        alsoWrite: async (tx) => {
          const linked = await linkedCheckOut(tx, scope, target);
          return linked
            ? [
                {
                  ...scope,
                  actorId: user.id,
                  userId: target.userId,
                  kind: 'UNDO',
                  supersedesId: linked.id,
                },
              ]
            : [];
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
