import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { generateUniqueAnonymousName } from './anonymousNames';
import { EventBudgetError, sessionEventBudget } from './event-budget';
import { effectiveEvents, EventKind, EventScope, foldEvents, ParticipationEvent } from './events';

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
  'COLD_CALL_DRAWN',
  'COLD_CALL_EXCUSED',
  'PROJECTION_REVOKED',
  'UNDO',
];
type AppendInput = EventScope & {
  actorId: string;
  userId?: string | null;
  kind: EventKind;
  payload?: Record<string, unknown>;
  supersedesId?: string;
  /** Runs inside the session lock before the write; throw ConflictError to refuse it. */
  guard?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Returns more events for the same session, written in the same transaction. */
  alsoWrite?: (tx: Prisma.TransactionClient, event: ParticipationEvent) => Promise<AppendInput[]>;
};

/** A guard refused an append because the session state changed. */
export class ConflictError extends Error {}

/** True when the event is in force: no superseder that is itself in force names it. */
export async function isEffective(
  db: PrismaClient | Prisma.TransactionClient,
  scope: EventScope,
  id: string
): Promise<boolean> {
  const events = await db.participationEvent.findMany({
    where: { courseId: scope.courseId, classId: scope.classId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return effectiveEvents(events.map(asEvent), scope).some((event) => event.id === id);
}

// Every stored payload is small. The largest legitimate one is an exam start with 50
// allowlisted domains.
const MAX_PAYLOAD_BYTES = 16384;
const MAX_TEXT: Record<string, number> = { message: 1000, anonymousName: 64, reason: 500 };

export function validatePayload(kind: EventKind, payload: Record<string, unknown>) {
  if (!kinds.includes(kind)) throw new Error('Unknown event kind');
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) {
    throw new Error('Event payload is too large');
  }
  for (const [key, max] of Object.entries(MAX_TEXT)) {
    if (typeof payload[key] === 'string' && (payload[key] as string).length > max) {
      throw new Error(`${key} must be ${max} characters or fewer`);
    }
  }
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
  if (kind === 'COLD_CALL_EXCUSED') {
    requiredString('reason');
  }
  if (kind === 'COLD_CALL_DRAWN' && !Number.isInteger(payload.seed)) {
    throw new Error('Invalid cold-call seed');
  }
  if (kind === 'COLD_CALL') {
    if (!['answered', 'pass', 'retry', 'absent', 'skip'].includes(payload.outcome as string))
      throw new Error('Invalid cold-call outcome');
    if (payload.seed !== undefined && !Number.isInteger(payload.seed))
      throw new Error('Invalid cold-call seed');
    if (payload.followUpOf !== undefined && typeof payload.followUpOf !== 'string')
      throw new Error('Invalid follow-up target');
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

const ORDER = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

/**
 * Every poll reads its session's log. Each database client keeps the logs it has read,
 * so a read fetches only events after the last one it holds. appendEvent and session
 * expiry give each new event a later createdAt than every event before it in its
 * session, so nothing is missed. A full reload each minute is a backstop.
 */
const FULL_RELOAD_MS = 60_000;
// Events held across all sessions; the session read longest ago goes first.
const MAX_CACHED_EVENTS = 200_000;
type CachedLog = { events: ParticipationEvent[]; loadedAt: number };
// Reads of one session run one after another, so each starts from the newest log.
type LogCache = {
  logs: Map<string, CachedLog>;
  size: number;
  reading: Map<string, Promise<CachedLog>>;
};
const caches = new WeakMap<object, LogCache>();

function cacheEnabled() {
  // Unit tests reuse one mocked client and one session across tests.
  return process.env.NODE_ENV !== 'test' || process.env.CHECKHEN_EVENT_CACHE === '1';
}

/** Tests only: events held for a client, and the sum of the held logs' lengths. */
export function cachedEventCounts(db: object) {
  const cache = caches.get(db);
  const held = cache
    ? Array.from(cache.logs.values()).reduce((sum, log) => sum + log.events.length, 0)
    : 0;
  return { counted: cache?.size ?? 0, held };
}

export async function readEvents(db: PrismaClient, scope: EventScope) {
  if (!cacheEnabled()) return readFullLog(db, scope);
  let cache = caches.get(db);
  if (!cache) {
    cache = { logs: new Map(), size: 0, reading: new Map() };
    caches.set(db, cache);
  }
  const held = cache;
  const key = `${scope.courseId}:${scope.classId}`;
  const previous = held.reading.get(key) ?? Promise.resolve(null);
  const read = previous.catch(() => null).then(() => refreshLog(db, held, key, scope));
  held.reading.set(key, read);
  try {
    return (await read).events.slice();
  } finally {
    if (held.reading.get(key) === read) held.reading.delete(key);
  }
}

async function readFullLog(db: PrismaClient, scope: EventScope) {
  return (await db.participationEvent.findMany({ where: scope, orderBy: ORDER })).map(asEvent);
}

async function refreshLog(db: PrismaClient, cache: LogCache, key: string, scope: EventScope) {
  const now = Date.now();
  const held = cache.logs.get(key);
  const last = held?.events.at(-1);
  let log: CachedLog;
  if (!held || !last || now - held.loadedAt >= FULL_RELOAD_MS) {
    log = { events: await readFullLog(db, scope), loadedAt: now };
  } else {
    const newer = (
      await db.participationEvent.findMany({
        where: {
          ...scope,
          OR: [
            { createdAt: { gt: last.createdAt } },
            { createdAt: last.createdAt, id: { gt: last.id } },
          ],
        },
        orderBy: ORDER,
      })
    ).map(asEvent);
    log = newer.length ? { events: held.events.concat(newer), loadedAt: held.loadedAt } : held;
  }
  // Another session's read may have evicted this one meanwhile; count what is held now.
  const current = cache.logs.get(key);
  if (current) {
    cache.size -= current.events.length;
    cache.logs.delete(key);
  }
  cache.logs.set(key, log);
  cache.size += log.events.length;
  while (cache.size > MAX_CACHED_EVENTS && cache.logs.size > 1) {
    const [oldest, evicted] = cache.logs.entries().next().value!;
    cache.logs.delete(oldest);
    cache.size -= evicted.events.length;
  }
  return log;
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
    if (input.guard) {
      await input.guard(tx);
    }
    const event = await writeEvent(tx, input);
    // Follow-on events commit or fail with the first one.
    for (const next of input.alsoWrite ? await input.alsoWrite(tx, event) : []) {
      if (next.courseId !== input.courseId || next.classId !== input.classId) {
        throw new Error('Follow-on events must stay in the same session');
      }
      // A follow-on is written as given; its own guard or follow-ons would be ignored.
      if (next.guard || next.alsoWrite) {
        throw new Error('A follow-on event cannot have its own guard or follow-ons');
      }
      validatePayload(next.kind, next.payload ?? {});
      await writeEvent(tx, next);
    }
    return event;
  });
}

// A student can still leave or lower a hand at the budget; each needs a current
// check-in, device, or raised hand, so these cannot repeat without bound.
const UNBUDGETED_KINDS: string[] = ['CHECK_OUT', 'DEVICE_UNBOUND', 'HAND_LOWERED'];

/**
 * Only events a student writes for themself count against the budget, so the
 * instructor can always correct, moderate, and end the session.
 */
async function checkBudget(tx: Prisma.TransactionClient, input: AppendInput, kind: string) {
  if (!input.userId || input.actorId !== input.userId || UNBUDGETED_KINDS.includes(kind)) return;
  const written = await tx.participationEvent.count({
    where: { courseId: input.courseId, classId: input.classId },
  });
  if (written >= sessionEventBudget()) {
    throw new EventBudgetError('This class session has reached its activity limit');
  }
}

/** Validate and write one event. The caller holds the session lock. */
async function writeEvent(tx: Prisma.TransactionClient, input: AppendInput) {
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
          current.attendance.filter((entry) => entry.isPresent).map((entry) => entry.anonymousName)
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
  if (kind === 'COLD_CALL_EXCUSED' && !input.supersedesId) {
    throw new Error('Excuse requires an absence');
  }
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
    // An excused absence supersedes the student's Absent call; both stay in the log.
    const excusesAbsence =
      kind === 'COLD_CALL_EXCUSED' &&
      previous.kind === 'COLD_CALL' &&
      (previous.payload as Record<string, unknown>).outcome === 'absent' &&
      input.userId === previous.userId;
    if (
      kind !== 'UNDO' &&
      !hidesMessage &&
      !excusesFail &&
      !excusesAbsence &&
      (kind !== previous.kind || input.userId !== previous.userId)
    ) {
      throw new Error('A correction must preserve event kind and student');
    }
    if (kind === 'CHAT_HIDDEN' && !hidesMessage)
      throw new Error('Hide must target a message by that student');
    if (kind === 'EXAM_EXCUSED' && !excusesFail)
      throw new Error('Excuse must target a fail by that student');
    if (kind === 'COLD_CALL_EXCUSED' && !excusesAbsence) {
      throw new Error('Excuse must target an absence by that student');
    }
  } else if (kind === 'UNDO') {
    throw new Error('Undo requires a target event');
  }
  if (kind === 'EXAM_FAILED' && typeof payload.failId === 'string') {
    // The agent may report one drop twice (a retried callback); store it once.
    const reported = await tx.participationEvent.findMany({
      where: {
        courseId: input.courseId,
        classId: input.classId,
        userId: input.userId,
        kind: 'EXAM_FAILED',
      },
    });
    const duplicate = reported.find(
      (event) => (event.payload as Record<string, unknown>).failId === payload.failId
    );
    if (duplicate) {
      return asEvent(duplicate);
    }
  }
  await checkBudget(tx, input, kind);
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
}
