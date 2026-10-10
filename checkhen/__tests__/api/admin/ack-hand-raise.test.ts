import { createMocks } from 'node-mocks-http';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/admin/ack-hand-raise';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }));
const admin = { id: 'admin', email: 'prof@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const state = {
  attendance: [],
  hands: [{ id: 'hand-1', userId: 'student', isAcknowledged: false }],
  pace: [],
  messages: [],
  endedAt: null,
};
const invoke = async (method: 'GET' | 'POST' = 'POST', currentState = state) => {
  (readState as jest.Mock).mockResolvedValue(currentState);
  const { req, res } = createMocks({ method, body: { email: 'student@bu.edu' }, query: scope });
  await handler(req as any, res as any);
  return res;
};
beforeEach(() => {
  jest.clearAllMocks();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user: admin, selected, admin: true });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'student',
    email: 'student@bu.edu',
  });
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
});
describe('POST /api/admin/ack-hand-raise', () => {
  it('rejects wrong methods', async () => expect((await invoke('GET'))._getStatusCode()).toBe(405));
  it('returns 401 without a session', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(401).json({ message: 'Unauthorized' }); return null; });
    expect((await invoke())._getStatusCode()).toBe(401);
  });
  it('propagates a 403 from scope authorization', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => {
      res.status(403).json({ message: 'Instructor access required' });
      return null;
    });
    const res = await invoke();
    expect(res._getStatusCode()).toBe(403);
    expect(requireScope).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  });
  it('acknowledges the selected hand through an event', async () => {
    expect((await invoke())._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        ...scope,
        userId: 'student',
        kind: 'HAND_ACKNOWLEDGED',
        payload: { handRaiseId: 'hand-1' },
      })
    );
  });
  it('returns 404 when email is missing', async () => {
    const { req, res } = createMocks({ method: 'POST', body: {}, query: scope });
    (readState as jest.Mock).mockResolvedValue(state);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(404);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: '' } });
  });
  it('looks up the requested student email', async () => {
    await invoke();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'student@bu.edu' } });
  });
  it('returns 404 when no unacknowledged hand exists', async () => {
    expect((await invoke('POST', { ...state, hands: [] }))._getStatusCode()).toBe(404);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
