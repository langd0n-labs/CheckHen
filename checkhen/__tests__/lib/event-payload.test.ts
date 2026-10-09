import { appendEvent, validatePayload } from '@/lib/event-store';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

it('refuses an oversized payload of any kind', () => {
  expect(() => validatePayload('PACE_RESET', { padding: 'x'.repeat(20000) })).toThrow(
    'Event payload is too large'
  );
});

it('caps the free text that other people see', () => {
  const chat = { message: 'x'.repeat(1001), anonymousName: 'Swift Panda' };
  expect(() => validatePayload('CHAT_MESSAGE', chat)).toThrow('message must be 1000');
  expect(() =>
    validatePayload('CHAT_MESSAGE', { message: 'hi', anonymousName: 'x'.repeat(65) })
  ).toThrow('anonymousName must be 64');
  expect(() =>
    validatePayload('EXAM_EXCUSED', { examId: 'exam', reason: 'x'.repeat(501) })
  ).toThrow('reason must be 500');
  expect(() =>
    validatePayload('CHAT_MESSAGE', { message: 'x'.repeat(1000), anonymousName: 'Swift Panda' })
  ).not.toThrow();
});

it('still accepts an exam start with fifty long domains', () => {
  const domains = Array.from(
    { length: 50 },
    (_, i) => `${'a'.repeat(60)}.${'b'.repeat(60)}.example${i}.edu`
  );
  expect(() =>
    validatePayload('EXAM_STARTED', { examId: 'exam', domains, thresholdSeconds: 30 })
  ).not.toThrow();
});

describe('a repeated exam fail report', () => {
  const stored = {
    id: 'fail-event',
    courseId: 'course',
    classId: 'class',
    userId: 'student',
    actorId: 'system:exam-monitor',
    kind: 'EXAM_FAILED',
    payload: { examId: 'exam', failId: 'drop-1' },
    createdAt: new Date(),
    supersedesId: null,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'class' }]),
    rosterEntry: { findUnique: jest.fn().mockResolvedValue({ active: true }) },
    participationEvent: {
      findMany: jest.fn().mockResolvedValue([stored]),
      findFirst: jest.fn().mockResolvedValue(stored),
      create: jest.fn(async ({ data }) => data),
    },
  };
  const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) } as any;
  const report = (failId: string) =>
    appendEvent(db, {
      courseId: 'course',
      classId: 'class',
      actorId: 'system:exam-monitor',
      userId: 'student',
      kind: 'EXAM_FAILED',
      payload: { examId: 'exam', failId },
    });

  it('is stored once, by its fail ID', async () => {
    expect((await report('drop-1')).id).toBe('fail-event');
    expect(tx.participationEvent.create).not.toHaveBeenCalled();
    await report('drop-2');
    expect(tx.participationEvent.create).toHaveBeenCalledTimes(1);
  });
});
