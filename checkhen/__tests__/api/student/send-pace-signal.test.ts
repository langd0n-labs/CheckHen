import { createMocks } from 'node-mocks-http';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/student/send-pace-signal';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));
const user = { id: 'student', email: 'student@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const state = {
  attendance: [{ userId: user.id, isPresent: true }],
  hands: [],
  pace: [],
  messages: [],
  endedAt: null,
};
const invoke = async (body: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') => {
  (readState as jest.Mock).mockResolvedValue(state);
  const { req, res } = createMocks({ method, body, query: scope });
  await handler(req as any, res as any);
  return res;
};
beforeEach(() => {
  jest.clearAllMocks();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: false });
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
});
describe('POST /api/student/send-pace-signal', () => {
  it('rejects wrong methods', async () =>
    expect((await invoke({}, 'GET'))._getStatusCode()).toBe(405));
  it.each([{}, { signalType: '' }, { signalType: 'speed_up' }])(
    'rejects missing or invalid signal types',
    async (body) => {
      expect((await invoke(body))._getStatusCode()).toBe(400);
      expect(appendEvent).not.toHaveBeenCalled();
    }
  );
  it('records a pace event without deleting prior signals', async () => {
    expect((await invoke({ signalType: 'slow_down' }))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        ...scope,
        kind: 'PACE_SIGNAL',
        payload: { signalType: 'slow_down' },
      })
    );
  });
});
