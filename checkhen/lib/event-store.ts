import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { generateUniqueAnonymousName } from './anonymousNames';
import { EventKind, EventScope, foldEvents, ParticipationEvent } from './events';

const kinds: EventKind[] = [
  'CHECK_IN',
  'CHECK_OUT',
  'HAND_RAISED',
  'HAND_LOWERED',
  'HAND_ACKNOWLEDGED',
  'HAND_RATED',
  'PACE_SIGNAL',
  'PACE_RESET',
  'CHAT_MESSAGE',
  'CHAT_HIDDEN',
  'STUDENT_MUTED',
  'EXAM_STARTED',
  'EXAM_ENDED',
  'EXAM_FAILED',
  'EXAM_EXCUSED',
  'SESSION_ENDED',
  'DEVICE_BOUND',
  'DEVICE_UNBOUND',
  'COLD_CALL',
  'UNDO',
];
type AppendInput = EventScope & {
  actorId: string;
  userId?: string | null;
  kind: EventKind;
  payload?: Record<string, unknown>;
  supersedesId?: string;
};

export function validatePayload(kind: EventKind, payload: Record<string, unknown>) {
  if (!kinds.includes(kind)) throw new Error('Unknown event kind');
  const requiredString = (key: string) => {
    if (typeof payload[key] !== 'string' || !(payload[key] as string).trim()) {
      throw new Error('Missing ' + key);
    }
  };
  if (kind === 'CHECK_IN') requiredString('anonymousName');
  if (kind === 'DEVICE_BOUND') {
    requiredString('deviceIp');
    requiredString('deviceMac');
  }
  if (kind === 'DEVICE_UNBOUND') requiredString('deviceIp');
  if (kind === 'CHAT_MESSAGE') {
    requiredString('message');
    requiredString('anonymousName');
  }
  if (kind === 'CHAT_HIDDEN') requiredString('messageId');
  if (kind === 'EXAM_STARTED') {
    requiredString('examId');
    if (
      !Array.isArray(payload.domains) ||
      payload.domains.some((domain) => typeof domain !== 'string') ||
      !Number.isInteger(payload.thresholdSeconds) ||
      Number(payload.thresholdSeconds) < 1
    )
      throw new Error('Invalid exam configuration');
  }
  if (kind === 'EXAM_FAILED') requiredString('examId');
  if (kind === 'COLD_CALL') {
    if (!['answered', 'pass', 'retry', 'absent'].includes(payload.outcome as string))
      throw new Error('Invalid cold-call outcome');
    if (payload.seed !== undefined && !Number.isInteger(payload.seed))
      throw new Error('Invalid cold-call seed');
  }
  if (kind === 'EXAM_ENDED') requiredString('examId');
  if (kind === 'EXAM_EXCUSED') {
    requiredString('examId');
    requiredString('reason');
  }
  if (['HAND_LOWERED', 'HAND_ACKNOWLEDGED', 'HAND_RATED'].includes(kind))
    requiredString('handRaiseId');
  if (kind === 'HAND_RATED' && typeof payload.hasValue !== 'boolean')
    throw new Error('Invalid rating');
  if (
    kind === 'PACE_SIGNAL' &&
    !['slow_down', 'ready_to_move_on'].includes(String(payload.signalType))
  ) {
    throw new Error('Invalid pace signal');
  }
}

export function asEvent(
  event: { kind: string; payload: Prisma.JsonValue } & Omit<ParticipationEvent, 'kind' | 'payload'>
): ParticipationEvent {
  return {
    ...event,
    kind: event.kind as EventKind,
    payload: event.payload as Record<string, unknown>,
  };
}

export async function readEvents(db: PrismaClient, scope: EventScope) {
  return (
    await db.participationEvent.findMany({
      where: scope,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(asEvent);
}

export async function readState(db: PrismaClient, scope: EventScope) {
  return foldEvents(await readEvents(db, scope), scope);
}

/** Serialize appends per session so timestamps and corrections have a total order. */
export async function appendEvent(db: PrismaClient, input: AppendInput) {
  validatePayload(input.kind, input.payload ?? {});
  return db.$transaction(async (tx) => {
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Class" WHERE "id" = ${input.classId} AND "courseId" = ${input.courseId} FOR UPDATE
    `;
    if (!sessions.length) throw new Error('Unknown course/session');
    let kind = input.kind;
    let payload = input.payload ?? {};
    if (kind === 'CHECK_IN' && input.userId && !input.supersedesId) {
      const current = foldEvents(
        (
          await tx.participationEvent.findMany({
            where: {
              courseId: input.courseId,
              classId: input.classId,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        ).map(asEvent),
        input
      );
      const present = current.attendance.find(
        (entry) => entry.userId === input.userId && entry.isPresent
      );
      if (present) {
        if (typeof payload.deviceIp === 'string' && typeof payload.deviceMac === 'string') {
          kind = 'DEVICE_BOUND';
          payload = { deviceIp: payload.deviceIp, deviceMac: payload.deviceMac };
        } else {
          const existing = await tx.participationEvent.findFirst({
            where: {
              courseId: input.courseId,
              classId: input.classId,
              userId: input.userId,
              kind: 'CHECK_IN',
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (existing) return asEvent(existing);
        }
      } else if (
        current.attendance.some(
          (entry) => entry.isPresent && entry.anonymousName === payload.anonymousName
        )
      ) {
        payload = {
          ...payload,
          anonymousName: generateUniqueAnonymousName(
            current.attendance
              .filter((entry) => entry.isPresent)
              .map((entry) => entry.anonymousName)
          ),
        };
      }
      validatePayload(kind, payload);
    }
    if (input.userId) {
      const member = await tx.rosterEntry.findUnique({
        where: { courseId_userId: { courseId: input.courseId, userId: input.userId } },
      });
      if (!member) throw new Error('Student is not on this course roster');
    }
    if (kind === 'STUDENT_MUTED' && !input.userId) throw new Error('Mute requires a student');
    if (kind === 'CHAT_HIDDEN' && !input.supersedesId) throw new Error('Hide requires a message');
    if (kind === 'EXAM_EXCUSED' && !input.supersedesId) throw new Error('Excuse requires a fail');
    if (input.supersedesId) {
      const previous = await tx.participationEvent.findFirst({
        where: { id: input.supersedesId, courseId: input.courseId, classId: input.classId },
      });
      if (!previous) throw new Error('Unknown superseded event');
      const hidesMessage =
        kind === 'CHAT_HIDDEN' &&
        previous.kind === 'CHAT_MESSAGE' &&
        payload.messageId === previous.id &&
        input.userId === previous.userId;
      const excusesFail =
        kind === 'EXAM_EXCUSED' &&
        previous.kind === 'EXAM_FAILED' &&
        payload.examId === (previous.payload as Record<string, unknown>).examId &&
        input.userId === previous.userId;
      if (
        kind !== 'UNDO' &&
        !hidesMessage &&
        !excusesFail &&
        (kind !== previous.kind || input.userId !== previous.userId)
      ) {
        throw new Error('A correction must preserve event kind and student');
      }
      if (kind === 'CHAT_HIDDEN' && !hidesMessage)
        throw new Error('Hide must target a message by that student');
      if (kind === 'EXAM_EXCUSED' && !excusesFail)
        throw new Error('Excuse must target a fail by that student');
    } else if (kind === 'UNDO') {
      throw new Error('Undo requires a target event');
    }
    const latest = await tx.participationEvent.findFirst({
      where: { courseId: input.courseId, classId: input.classId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
    return asEvent(
      await tx.participationEvent.create({
        data: {
          id: randomUUID(),
          courseId: input.courseId,
          classId: input.classId,
          userId: input.userId ?? null,
          actorId: input.actorId,
          kind,
          payload: payload as Prisma.InputJsonObject,
          createdAt,
          supersedesId: input.supersedesId ?? null,
        },
      })
    );
  });
}
