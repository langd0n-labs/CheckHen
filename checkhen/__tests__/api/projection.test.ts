import { createMocks } from 'node-mocks-http';
import { requireScope } from '@/lib/request-scope';
import { readState } from '@/lib/event-store';
import { createHmac } from 'node:crypto';
import { purposeKey } from '@/lib/keys';
import { mintProjectionTicket } from '@/lib/projection-auth';
import projectionTicket from '@/pages/api/admin/projection-ticket';
import projectionChat from '@/pages/api/projection/chat';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const scope = { courseId: 'course', classId: 'class' };
const secret = 'test-secret';
const key = () => purposeKey('projection-ticket', secret)!;
const live = (extra: Record<string, unknown> = {}) => ({
  messages: [{
    id: 'message', userId: 'student', classId: 'class', message: 'Question?',
    anonymousName: 'Swift Panda', createdAt: new Date(),
  }],
  endedAt: null,
  projectionGeneration: 0,
  ...extra,
});
const invoke = async (handler: typeof projectionChat, method: 'GET' | 'POST', ticket?: string) => {
  const { req, res } = createMocks({ method, query: { ...scope, ticket },
    headers: { origin: 'http://localhost:3030' } });
  await handler(req as any, res as any);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AUTH_SECRET = secret;
  process.env.SLIDEV_ORIGIN = 'http://localhost:3030';
  (requireScope as jest.Mock).mockResolvedValue({ scope,
    selected: { createdAt: new Date(Date.now() - 1000), duration: 60 } });
  (readState as jest.Mock).mockResolvedValue(live());
});

it('issues a scoped ticket only through the instructor route', async () => {
  const res = await invoke(projectionTicket, 'POST');
  expect(res._getStatusCode()).toBe(200);
  expect(requireScope).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  expect(res._getJSONData().ticket).toMatch(/\./);
});

it('delivers anonymous chat for I5 and I6 and allows only the configured deck origin', async () => {
  const ticket = mintProjectionTicket(scope, Date.now() + 60000, 0, key());
  const res = await invoke(projectionChat, 'GET', ticket);
  expect(res._getStatusCode()).toBe(200);
  expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:3030');
  expect(res._getJSONData().messages[0]).toMatchObject({ anonymousName: 'Swift Panda', message: 'Question?' });
  expect(JSON.stringify(res._getJSONData())).not.toContain('student');
  expect(JSON.stringify(res._getJSONData())).not.toContain('email');
});

it('rejects expired and tampered projection access', async () => {
  expect((await invoke(projectionChat, 'GET', mintProjectionTicket(scope, Date.now() - 1, 0, key())))
    ._getStatusCode()).toBe(403);
  expect((await invoke(projectionChat, 'GET', 'bad.ticket'))._getStatusCode()).toBe(403);
  expect(readState).not.toHaveBeenCalled();
});

// The projection route caches a session's state for half a second, so each case uses its own session.
it('refuses reads and new tickets once the session has ended', async () => {
  const ended = { courseId: 'course', classId: 'ended-class' };
  (requireScope as jest.Mock).mockResolvedValue({ scope: ended,
    selected: { createdAt: new Date(Date.now() - 1000), duration: 60 } });
  (readState as jest.Mock).mockResolvedValue(live({ endedAt: new Date() }));
  expect((await invoke(projectionTicket, 'POST'))._getStatusCode()).toBe(400);
  const ticket = mintProjectionTicket(ended, Date.now() + 60000, 0, key());
  expect((await invoke(projectionChat, 'GET', ticket))._getStatusCode()).toBe(403);
});

it('refuses a ticket minted before the links were revoked, and accepts a new one', async () => {
  const revoked = { courseId: 'course', classId: 'revoked-class' };
  (readState as jest.Mock).mockResolvedValue(live({ projectionGeneration: 1 }));
  expect((await invoke(projectionChat, 'GET', mintProjectionTicket(revoked, Date.now() + 60000, 0, key())))
    ._getStatusCode()).toBe(403);
  expect((await invoke(projectionChat, 'GET', mintProjectionTicket(revoked, Date.now() + 60000, 1, key())))
    ._getStatusCode()).toBe(200);
});

it('mints a ticket that carries the current generation', async () => {
  (readState as jest.Mock).mockResolvedValue(live({ projectionGeneration: 2 }));
  const { ticket } = (await invoke(projectionTicket, 'POST'))._getJSONData();
  expect(JSON.parse(Buffer.from(ticket.split('.')[0], 'base64url').toString()).generation).toBe(2);
});

it('refuses a ticket signed with AUTH_SECRET itself', async () => {
  const payload = Buffer.from(JSON.stringify({ courseId: 'course', classId: 'raw-class', typ: 'projection',
    projection: true, expires: Date.now() + 60000, generation: 0 })).toString('base64url');
  const raw = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  expect((await invoke(projectionChat, 'GET', raw))._getStatusCode()).toBe(403);
});
