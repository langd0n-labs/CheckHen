import { validatePayload } from '@/lib/event-store';

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
