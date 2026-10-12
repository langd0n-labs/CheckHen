import { createMocks } from 'node-mocks-http';
import { requireScope } from '@/lib/request-scope';
import { readState } from '@/lib/event-store';
import { mintProjectionTicket } from '@/lib/projection-auth';
import projectionTicket from '@/pages/api/admin/projection-ticket';
import projectionChat from '@/pages/api/projection/chat';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const scope = { courseId: 'course', classId: 'class' };
const secret = 'test-secret';
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
  (readState as jest.Mock).mockResolvedValue({ messages: [{
    id: 'message', userId: 'student', classId: 'class', message: 'Question?',
    anonymousName: 'Swift Panda', createdAt: new Date(),
  }] });
});

it('issues a scoped ticket only through the instructor route', async () => {
  const res = await invoke(projectionTicket, 'POST');
  expect(res._getStatusCode()).toBe(200);
  expect(requireScope).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  expect(res._getJSONData().ticket).toMatch(/\./);
});

it('delivers anonymous chat for I5 and I6 and allows only the configured deck origin', async () => {
  const ticket = mintProjectionTicket(scope, Date.now() + 60000, secret);
  const res = await invoke(projectionChat, 'GET', ticket);
  expect(res._getStatusCode()).toBe(200);
  expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:3030');
  expect(res._getJSONData().messages[0]).toMatchObject({ anonymousName: 'Swift Panda', message: 'Question?' });
  expect(JSON.stringify(res._getJSONData())).not.toContain('student');
  expect(JSON.stringify(res._getJSONData())).not.toContain('email');
});

it('rejects expired and tampered projection access', async () => {
  expect((await invoke(projectionChat, 'GET', mintProjectionTicket(scope, Date.now() - 1, secret)))
    ._getStatusCode()).toBe(403);
  expect((await invoke(projectionChat, 'GET', 'bad.ticket'))._getStatusCode()).toBe(403);
  expect(readState).not.toHaveBeenCalled();
});
