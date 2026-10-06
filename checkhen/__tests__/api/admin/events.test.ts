import { createMocks } from 'node-mocks-http';
import { appendEvent } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/admin/events';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({
  appendEvent: jest.fn(),
  readEvents: jest.fn(),
  readState: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({ prisma: { participationEvent: { findFirst: jest.fn() } } }));

const scope = { courseId: 'course-a', classId: 'session-a' };
const stored: Record<string, { kind: string; supersedesId: string | null }> = {
  call: { kind: 'COLD_CALL', supersedesId: null },
  undoCall: { kind: 'UNDO', supersedesId: 'call' },
  fail: { kind: 'EXAM_FAILED', supersedesId: null },
  chat: { kind: 'CHAT_MESSAGE', supersedesId: null },
};

const post = async (body: Record<string, unknown>) => {
  const { req, res } = createMocks({ method: 'POST', query: scope, body });
  await handler(req as any, res as any);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user: { id: 'instructor' }, admin: true });
  (prisma.participationEvent.findFirst as jest.Mock).mockImplementation(
    async ({ where }: { where: { id: string } }) => stored[where.id] ?? null
  );
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'new' });
});

describe('POST /api/admin/events', () => {
  it.each(['COLD_CALL', 'EXAM_STARTED', 'EXAM_ENDED', 'EXAM_FAILED', 'EXAM_EXCUSED'])(
    'refuses a %s event',
    async (kind) => {
      const res = await post({ kind, payload: { outcome: 'answered', examId: 'exam' } });
      expect(res._getStatusCode()).toBe(400);
      expect(appendEvent).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['an undo of a cold call', 'call'],
    ['an undo of an exam fail', 'fail'],
    ['an undo of an undone cold call', 'undoCall'],
  ])('refuses %s', async (_label, supersedesId) => {
    const res = await post({ kind: 'UNDO', supersedesId });
    expect(res._getStatusCode()).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('refuses a correction aimed at a cold call', async () => {
    const res = await post({
      kind: 'CHAT_MESSAGE',
      payload: { message: 'x' },
      supersedesId: 'call',
    });
    expect(res._getStatusCode()).toBe(400);
  });

  it('still accepts an undo of an ordinary event', async () => {
    const res = await post({ kind: 'UNDO', supersedesId: 'chat' });
    expect(res._getStatusCode()).toBe(201);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ kind: 'UNDO', supersedesId: 'chat' })
    );
  });
});
