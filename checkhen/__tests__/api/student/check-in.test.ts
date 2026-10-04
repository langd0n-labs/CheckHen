import { createMocks } from 'node-mocks-http';
import { generateUniqueAnonymousName } from '@/lib/anonymousNames';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/student/check-in';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/anonymousNames', () => ({ generateUniqueAnonymousName: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const user = { id: 'student', email: 'student@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const empty = () => ({
  attendance: [] as Array<{ userId: string; anonymousName: string; isPresent: boolean }>,
  hands: [],
  pace: [],
  messages: [],
  endedAt: null as Date | null,
});
const invoke = async (method: 'GET' | 'POST', state = empty()) => {
  (readState as jest.Mock).mockResolvedValue(state);
  const { req, res } = createMocks({ method, query: scope });
  await handler(req as any, res as any);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: false });
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
  (generateUniqueAnonymousName as jest.Mock).mockReturnValue('Calm Otter');
});

describe('POST /api/student/check-in', () => {
  it('rejects wrong methods', async () => expect((await invoke('GET'))._getStatusCode()).toBe(405));
  it('rejects an ended session without recording a check-in event', async () => {
    expect((await invoke('POST', { ...empty(), endedAt: new Date() }))._getStatusCode()).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('records a check-in event with a unique anonymous name', async () => {
    const res = await invoke('POST', {
      ...empty(),
      attendance: [{ userId: 'other', anonymousName: 'Swift Panda', isPresent: true }],
    });
    expect(res._getStatusCode()).toBe(200);
    expect(generateUniqueAnonymousName).toHaveBeenCalledWith(['Swift Panda']);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        ...scope,
        userId: user.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: 'Calm Otter' },
      })
    );
  });
  it('does not duplicate an active check-in', async () => {
    const res = await invoke('POST', {
      ...empty(),
      attendance: [{ userId: user.id, anonymousName: 'Swift Panda', isPresent: true }],
    });
    expect(res._getStatusCode()).toBe(200);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
