/** Understanding checks: the instructor asks whether a section landed; students answer. */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { appendEvent, asEvent, ConflictError } from './event-store';
import {
  checkOpenAt,
  foldEvents,
  UNDERSTANDING_CHOICES,
  type Check,
  type EventScope,
} from './events';

/** Operator decision 2026-10-09: a check closes itself after 3 minutes unless set otherwise. */
export const DEFAULT_CHECK_MINUTES = 3;
export const MAX_CHECK_MINUTES = 30;

async function lockedState(tx: Prisma.TransactionClient, scope: EventScope) {
  const events = await tx.participationEvent.findMany({
    where: { courseId: scope.courseId, classId: scope.classId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return foldEvents(events.map(asEvent), scope);
}

/** The check that takes answers now, if any. */
export function openCheck(checks: Check[], now = new Date()): Check | null {
  return checks.find((check) => checkOpenAt(check, now)) ?? null;
}

/** Open a check. `minutes` null: no timer, the instructor closes it. One at a time. */
export async function startCheck(
  db: PrismaClient,
  scope: EventScope,
  actorId: string,
  options: { label?: string; minutes: number | null }
) {
  const checkId = randomUUID();
  const label = options.label?.trim() ?? '';
  return appendEvent(db, {
    ...scope,
    actorId,
    userId: null,
    kind: 'CHECK_OPENED',
    payload: {
      checkId,
      kind: 'understanding',
      choices: UNDERSTANDING_CHOICES,
      ...(label ? { label } : {}),
      closesAt:
        options.minutes === null
          ? null
          : new Date(Date.now() + options.minutes * 60_000).toISOString(),
    },
    guard: async (tx) => {
      if (openCheck((await lockedState(tx, scope)).checks)) {
        throw new ConflictError('A check is already open. Close it first.');
      }
    },
  });
}

export async function closeCheck(
  db: PrismaClient,
  scope: EventScope,
  actorId: string,
  checkId: string
) {
  return appendEvent(db, {
    ...scope,
    actorId,
    userId: null,
    kind: 'CHECK_CLOSED',
    payload: { checkId },
    guard: async (tx) => {
      const check = (await lockedState(tx, scope)).checks.find((c) => c.checkId === checkId);
      if (!check || !checkOpenAt(check, new Date())) {
        throw new ConflictError('This check is already closed');
      }
    },
  });
}

/** Record a student's answer. A later answer replaces an earlier one while the check is open. */
export async function answerCheck(
  db: PrismaClient,
  scope: EventScope,
  userId: string,
  checkId: string,
  choice: string
) {
  return appendEvent(db, {
    ...scope,
    actorId: userId,
    userId,
    kind: 'CHECK_ANSWERED',
    payload: { checkId, choice },
    guard: async (tx) => {
      const state = await lockedState(tx, scope);
      const check = state.checks.find((c) => c.checkId === checkId);
      if (!check || !checkOpenAt(check, new Date())) {
        throw new ConflictError('This check has closed');
      }
      if (!check.choices.includes(choice)) {
        throw new ConflictError('Choose one of the answers');
      }
      if (!state.attendance.some((entry) => entry.userId === userId && entry.isPresent)) {
        throw new ConflictError('Check in to answer');
      }
    },
  });
}

/** Answers per choice, in the check's choice order. */
export function tally(check: Check): Record<string, number> {
  return Object.fromEntries(
    check.choices.map((choice) => [
      choice,
      check.answers.filter((answer) => answer.choice === choice).length,
    ])
  );
}

/** Share of answers (not of students present) asking for another example. */
export function anotherExampleShare(check: Check): number {
  if (!check.answers.length) {
    return 0;
  }
  return (
    check.answers.filter((answer) => answer.choice === 'another_example').length /
    check.answers.length
  );
}
