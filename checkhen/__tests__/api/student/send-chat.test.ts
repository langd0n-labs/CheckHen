import { createMocks } from 'node-mocks-http';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/student/send-chat';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));
const user = { id: 'student', email: 'student@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const checkedIn = () => ({
  attendance: [{ userId: user.id, anonymousName: 'Swift Panda', isPresent: true }],
  hands: [],
  pace: [],
  messages: [],
  endedAt: null as Date | null,
});
const invoke = async (
  body: Record<string, unknown>,
  state = checkedIn(),
  method: 'GET' | 'POST' = 'POST'
) => {
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
describe('POST /api/student/send-chat', () => {
  it('rejects wrong methods', async () =>
    expect((await invoke({}, checkedIn(), 'GET'))._getStatusCode()).toBe(405));
  it.each([{}, { message: '' }, { message: '   ' }, { message: 'x'.repeat(1001) }])(
    'rejects invalid messages',
    async (body) => {
      expect((await invoke(body))._getStatusCode()).toBe(400);
      expect(appendEvent).not.toHaveBeenCalled();
    }
  );
  it('rejects an ended session without recording a chat event', async () => {
    expect(
      (await invoke({ message: 'hello' }, { ...checkedIn(), endedAt: new Date() }))._getStatusCode()
    ).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('writes a chat event and accepts 1000 characters', async () => {
    const message = 'x'.repeat(1000);
    const res = await invoke({ message });
    expect(res._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        ...scope,
        kind: 'CHAT_MESSAGE',
        payload: { message, anonymousName: 'Swift Panda' },
      })
    );
  });
});
