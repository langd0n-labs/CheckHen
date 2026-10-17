import { createMocks } from 'node-mocks-http';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/student/send-pace-signal';
import { EventBudgetError } from '@/lib/event-budget';
import { resetWriteLimits } from '@/lib/write-limits';

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
const invoke = async (body: Record<string, unknown>, method: 'GET' | 'POST' = 'POST', currentState: Record<string, unknown> = state) => {
  (readState as jest.Mock).mockResolvedValue(currentState);
  const { req, res } = createMocks({ method, body, query: scope });
  await handler(req as any, res as any);
  return res;
};
beforeEach(() => {
  jest.clearAllMocks();
  resetWriteLimits();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: false });
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
});
describe('POST /api/student/send-pace-signal', () => {
  it('rejects wrong methods', async () =>
    expect((await invoke({}, 'GET'))._getStatusCode()).toBe(405));
  it('returns 401 without a session', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(401).json({ message: 'Unauthorized' }); return null; });
    expect((await invoke({ signalType: 'slow_down' }))._getStatusCode()).toBe(401);
  });
  it('rejects a student without an active check-in', async () => {
    expect((await invoke({ signalType: 'slow_down' }, 'POST', { ...state, attendance: [] }))._getStatusCode()).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
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
  it('does not write a repeat of the student\'s current signal', async () => {
    const current = { ...state, pace: [{ userId: user.id, signalType: 'slow_down', createdAt: new Date() }] };
    expect((await invoke({ signalType: 'slow_down' }, 'POST', current))._getStatusCode()).toBe(200);
    expect(appendEvent).not.toHaveBeenCalled();
    expect((await invoke({ signalType: 'ready_to_move_on' }, 'POST', current))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });
  it('writes a repeat after a minute, so the signal stays current', async () => {
    const old = { ...state, pace: [{ userId: user.id, signalType: 'slow_down', createdAt: new Date(Date.now() - 61000) }] };
    expect((await invoke({ signalType: 'slow_down' }, 'POST', old))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });
  it('refuses a student past the per-minute limit with 429', async () => {
    for (let i = 0; i < 30; i += 1) await invoke({ signalType: i % 2 ? 'slow_down' : 'ready_to_move_on' });
    const res = await invoke({ signalType: 'slow_down' });
    expect(res._getStatusCode()).toBe(429);
    expect(res.getHeader('Retry-After')).toBe('60');
  });
  it('answers 429 when the session has reached its event budget', async () => {
    (appendEvent as jest.Mock).mockRejectedValue(new EventBudgetError('This class session has reached its activity limit'));
    const res = await invoke({ signalType: 'slow_down' });
    expect(res._getStatusCode()).toBe(429);
    expect(res._getJSONData().message).toMatch(/activity limit/);
  });
  it('records a ready-to-move-on signal', async () => {
    expect((await invoke({ signalType: 'ready_to_move_on' }))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({
      kind: 'PACE_SIGNAL', payload: { signalType: 'ready_to_move_on' },
    }));
  });
});
