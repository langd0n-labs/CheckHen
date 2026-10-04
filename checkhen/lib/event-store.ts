import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { EventKind, EventScope, ParticipationEvent, foldEvents } from './events';
import { generateUniqueAnonymousName } from './anonymousNames';

const kinds: EventKind[] = [
  'CHECK_IN', 'CHECK_OUT', 'HAND_RAISED', 'HAND_LOWERED', 'HAND_ACKNOWLEDGED',
  'HAND_RATED', 'PACE_SIGNAL', 'PACE_RESET', 'CHAT_MESSAGE', 'SESSION_ENDED', 'DEVICE_BOUND', 'DEVICE_UNBOUND', 'UNDO',
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
  if (kind === 'DEVICE_BOUND') { requiredString('deviceIp'); requiredString('deviceMac'); }
  if (kind === 'DEVICE_UNBOUND') requiredString('deviceIp');
  if (kind === 'CHAT_MESSAGE') { requiredString('message'); requiredString('anonymousName'); }
  if (['HAND_LOWERED', 'HAND_ACKNOWLEDGED', 'HAND_RATED'].includes(kind)) requiredString('handRaiseId');
  if (kind === 'HAND_RATED' && typeof payload.hasValue !== 'boolean') throw new Error('Invalid rating');
  if (kind === 'PACE_SIGNAL' && !['slow_down', 'ready_to_move_on'].includes(String(payload.signalType))) {
    throw new Error('Invalid pace signal');
  }
}

export function asEvent(event: { kind: string; payload: Prisma.JsonValue } & Omit<ParticipationEvent, 'kind' | 'payload'>): ParticipationEvent {
  return { ...event, kind: event.kind as EventKind, payload: event.payload as Record<string, unknown> };
}

export async function readEvents(db: PrismaClient, scope: EventScope) {
  return (await db.participationEvent.findMany({
    where: scope, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })).map(asEvent);
}

export async function readState(db: PrismaClient, scope: EventScope) {
  return foldEvents(await readEvents(db, scope), scope);
}

/** Serialize appends per session so timestamps and corrections have a total order. */
export async function appendEvent(db: PrismaClient, input: AppendInput) {
  validatePayload(input.kind, input.payload ?? {});
  return db.$transaction(async tx => {
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Class" WHERE "id" = ${input.classId} AND "courseId" = ${input.courseId} FOR UPDATE
    `;
    if (!sessions.length) throw new Error('Unknown course/session');
    let kind = input.kind;
    let payload = input.payload ?? {};
    if (kind === 'CHECK_IN' && input.userId && !input.supersedesId) {
      const current = foldEvents((await tx.participationEvent.findMany({ where: {
        courseId: input.courseId, classId: input.classId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })).map(asEvent), input);
      const present = current.attendance.find(entry => entry.userId === input.userId && entry.isPresent);
      if (present) {
        if (typeof payload.deviceIp === 'string' && typeof payload.deviceMac === 'string') {
          kind = 'DEVICE_BOUND';
          payload = { deviceIp: payload.deviceIp, deviceMac: payload.deviceMac };
        } else {
          const existing = await tx.participationEvent.findFirst({ where: {
            courseId: input.courseId, classId: input.classId, userId: input.userId, kind: 'CHECK_IN',
          }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
          if (existing) return asEvent(existing);
        }
      } else if (current.attendance.some(entry => entry.isPresent && entry.anonymousName === payload.anonymousName)) {
        payload = { ...payload, anonymousName: generateUniqueAnonymousName(
          current.attendance.filter(entry => entry.isPresent).map(entry => entry.anonymousName)) };
      }
      validatePayload(kind, payload);
    }
    if (input.userId) {
      const member = await tx.rosterEntry.findUnique({
        where: { courseId_userId: { courseId: input.courseId, userId: input.userId } },
      });
      if (!member) throw new Error('Student is not on this course roster');
    }
    if (input.supersedesId) {
      const previous = await tx.participationEvent.findFirst({
        where: { id: input.supersedesId, courseId: input.courseId, classId: input.classId },
      });
      if (!previous) throw new Error('Unknown superseded event');
      if (kind !== 'UNDO' && (kind !== previous.kind || input.userId !== previous.userId)) {
        throw new Error('A correction must preserve event kind and student');
      }
    } else if (kind === 'UNDO') {
      throw new Error('Undo requires a target event');
    }
    const latest = await tx.participationEvent.findFirst({
      where: { courseId: input.courseId, classId: input.classId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
    return asEvent(await tx.participationEvent.create({
      data: {
        id: randomUUID(), courseId: input.courseId, classId: input.classId,
        userId: input.userId ?? null, actorId: input.actorId, kind,
        payload: payload as Prisma.InputJsonObject, createdAt,
        supersedesId: input.supersedesId ?? null,
      },
    }));
  });
}
