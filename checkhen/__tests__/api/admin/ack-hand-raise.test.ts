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
const invoke = async (method: 'GET' | 'POST' = 'POST') => {
  (readState as jest.Mock).mockResolvedValue(state);
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
});
