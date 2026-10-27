import { createMocks } from 'node-mocks-http';
import { getServerSession } from 'next-auth';
import { requireIdentity } from '@/lib/request-scope';
import { demoGate } from '@/lib/demo-guard';
import { prisma } from '@/lib/prisma';
import updateProfile from '@/pages/api/student/update-profile';
import uploadPhoto from '@/pages/api/student/upload-profile-picture';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('@/lib/demo-guard', () => ({ demoGate: jest.fn() }));
jest.mock('@/lib/demo', () => ({ isDemo: () => false }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn(), update: jest.fn() } } }));
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXTAUTH_URL = 'https://checkhen.test/auth';
  (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'student@bu.edu' } });
  (demoGate as jest.Mock).mockResolvedValue(true);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'student' });
});
const handlers = [requireIdentity, updateProfile, uploadPhoto];
describe.each(handlers)('%p cookie write guard', (handler) => {
  const invoke = async (headers: Record<string, any>, rawHeaders?: string[]) => {
    const { req, res } = createMocks({ method: 'POST', headers, body: { imageBase64: 'data:image/png;base64,AAAA' } });
    if (rawHeaders) req.rawHeaders = rawHeaders;
    await handler(req as any, res as any);
    return res._getStatusCode();
  };
  const untouched = () => {
    expect(demoGate).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  };
  it.each([undefined, 'null', 'garbage', 'https://sibling.checkhen.test', 'https://evil.test',
    'https://checkhen.test.evil.test', 'https://checkhen.test/',
    'https://checkhen.test, https://checkhen.test', ['https://checkhen.test'],
    'https://checkhen.test https://evil.test'])('rejects origin %p before counters/persistence', async (origin) => {
    expect(await invoke({ origin, 'content-type': 'application/json', host: 'checkhen.test',
      'x-forwarded-host': 'checkhen.test', 'x-forwarded-proto': 'https' })).toBe(403);
    untouched();
  });
  it.each([undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data',
    'application/json, text/plain', 'application/jsonp'])('rejects media type %p', async (type) => {
    expect(await invoke({ origin: 'https://checkhen.test', 'content-type': type })).toBe(415);
    untouched();
  });
  it.each(['application/json', 'application/json; charset=utf-8'])('accepts %s despite spoofed Host', async (type) => {
    expect(await invoke({ origin: 'https://checkhen.test', 'content-type': type,
      host: 'evil.test', 'x-forwarded-host': 'evil.test' })).toBe(200);
    expect(handler === requireIdentity ? prisma.user.findUnique : prisma.user.update).toHaveBeenCalled();
  });
  it.each([undefined, '', 'not-a-url', 'https:checkhen.test', ' https://checkhen.test', 'null', 'file:///tmp/example', 'https://user:pass@checkhen.test'])('fails closed for config %p', async (url) => {
    if (url === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = url;
    expect(await invoke({ origin: 'https://checkhen.test', 'content-type': 'application/json' })).toBe(403);
    untouched();
  });
  it('rejects repeated raw Origin headers', async () => {
    expect(await invoke({ origin: 'https://checkhen.test', 'content-type': 'application/json' },
      ['Origin', 'https://checkhen.test', 'origin', 'https://checkhen.test'])).toBe(403);
    untouched();
  });
  it('preserves anonymous 401', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    expect(await invoke({})).toBe(401);
    untouched();
  });
});
it.each(['GET', 'HEAD', 'OPTIONS'])('leaves %s unchanged without config or write headers', async (method) => {
  delete process.env.NEXTAUTH_URL;
  const { req, res } = createMocks({ method: method as any });
  expect(await requireIdentity(req as any, res as any)).toBeTruthy();
});
