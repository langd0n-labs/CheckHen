import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createMocks } from 'node-mocks-http';
import portalExpired from '@/pages/api/internal/portal-expired';
import expireSessionsRoute from '@/pages/api/internal/expire-sessions';
import { appendEvent, readState } from '@/lib/event-store';
import { expireSessions } from '@/lib/session-expiry';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/session-expiry', () => ({ expireSessions: jest.fn() }));

const secret = 'route-test-secret';
const sign = (raw: string) => createHmac('sha256', secret).update(raw).digest('hex');
const scope = { userId: 'student', courseId: 'course', classId: 'class' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PORTAL_CONTROL_SECRET = secret;
  process.env.AUTH_SECRET = secret;
  (readState as jest.Mock).mockResolvedValue({ attendance: [{ userId: 'student', isPresent: true }] });
  (expireSessions as jest.Mock).mockResolvedValue(2);
});

describe('portal expiry callback', () => {
  const invoke = async (raw: string, signature = sign(raw)) => {
    const { res } = createMocks();
    const req = Object.assign(Readable.from([Buffer.from(raw)]), {
      method: 'POST', headers: { 'x-checkhen-signature': signature },
    });
    await portalExpired(req as any, res as any);
    return res;
  };
  it('requires a valid signature and recent timestamp', async () => {
    const raw = JSON.stringify({ ...scope, timestamp: Date.now() });
    expect((await invoke(raw, 'bad'))._getStatusCode()).toBe(403);
    expect((await invoke(JSON.stringify({ ...scope, timestamp: Date.now() - 60000 })))._getStatusCode()).toBe(403);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('rejects malformed signed JSON', async () => {
    expect((await invoke('{bad'))._getStatusCode()).toBe(400);
  });
  it('checks out only a present student', async () => {
    const raw = JSON.stringify({ ...scope, timestamp: Date.now() });
    expect((await invoke(raw))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'CHECK_OUT', userId: 'student', courseId: 'course', classId: 'class',
    }));
    (appendEvent as jest.Mock).mockClear();
    (readState as jest.Mock).mockResolvedValue({ attendance: [{ userId: 'student', isPresent: false }] });
    expect((await invoke(raw))._getStatusCode()).toBe(200);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});

describe('session expiry callback', () => {
  const invoke = async (body: unknown, signature?: string) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body ?? null);
    const { req, res } = createMocks({ method: 'POST', body: body as any,
      headers: { 'x-checkhen-signature': signature ?? sign(raw) } });
    await expireSessionsRoute(req as any, res as any);
    return res;
  };
  it('requires a valid signature and recent timestamp', async () => {
    expect((await invoke({ timestamp: Date.now() }, 'bad'))._getStatusCode()).toBe(403);
    expect((await invoke({ timestamp: Date.now() - 60000 }))._getStatusCode()).toBe(403);
    expect(expireSessions).not.toHaveBeenCalled();
  });
  it('rejects malformed signed bodies', async () => {
    expect((await invoke({ nope: true }))._getStatusCode()).toBe(400);
  });
  it('runs expiry after authentication', async () => {
    const res = await invoke({ timestamp: Date.now() });
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ ended: 2 });
    expect(expireSessions).toHaveBeenCalledTimes(1);
  });
});
