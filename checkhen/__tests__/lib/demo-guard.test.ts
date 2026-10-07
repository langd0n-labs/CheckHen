import { createMocks } from 'node-mocks-http';
import { getServerSession } from 'next-auth';
import { DEMO_INSTRUCTOR } from '@/lib/demo';
import { demoGate, resetDemoLimits } from '@/lib/demo-guard';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';
import coursesRoute from '@/pages/api/courses';
import rosterRoute from '@/pages/api/admin/roster';
import uploadRoute from '@/pages/api/student/upload-profile-picture';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    user: { count: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    course: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    rosterEntry: { upsert: jest.fn() },
  },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

const request = (method = 'POST', ip = '203.0.113.5', body: Record<string, unknown> = {}) =>
  createMocks({ method: method as any, headers: { 'cf-connecting-ip': ip }, body });

beforeEach(() => {
  jest.clearAllMocks();
  resetDemoLimits();
  process.env.CHECKHEN_DEMO = '1';
  process.env.CHECKHEN_MODE = 'hosted';
  (prisma.user.count as jest.Mock).mockResolvedValue(0);
  (prisma.course.count as jest.Mock).mockResolvedValue(0);
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ bytes: BigInt(10 * 1024 * 1024) }]);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'hoot', email: DEMO_INSTRUCTOR });
  (prisma.course.findUnique as jest.Mock).mockResolvedValue({ id: 'course' });
  (getServerSession as jest.Mock).mockResolvedValue({ user: { email: DEMO_INSTRUCTOR } });
});

afterEach(() => {
  delete process.env.CHECKHEN_DEMO;
  delete process.env.CHECKHEN_MODE;
  delete process.env.DEMO_MAX_DATABASE_MB;
});

const gate = async (method = 'POST', ip?: string, bucket?: 'write' | 'reset') => {
  const { req, res } = request(method, ip);
  const allowed = await demoGate(req as any, res as any, bucket);
  return { allowed, status: res._getStatusCode() };
};

it('allows everything outside demo mode without touching the database', async () => {
  process.env.CHECKHEN_MODE = 'classroom';
  for (let i = 0; i < 100; i += 1) {
    expect((await gate()).allowed).toBe(true);
  }
  expect(prisma.user.count).not.toHaveBeenCalled();
});

it('limits writes per client, and never limits reads', async () => {
  for (let i = 0; i < 60; i += 1) {
    expect((await gate()).allowed).toBe(true);
  }
  expect(await gate()).toEqual({ allowed: false, status: 429 });
  expect((await gate('GET')).allowed).toBe(true);
  expect((await gate('POST', '198.51.100.7')).allowed).toBe(true);
});

it('limits writes overall, whatever address a client claims', async () => {
  for (let i = 0; i < 600; i += 1) {
    await gate('POST', `198.51.100.${i % 200}`);
  }
  expect(await gate('POST', '192.0.2.1')).toEqual({ allowed: false, status: 429 });
});

it('limits resets more tightly than other writes', async () => {
  for (let i = 0; i < 3; i += 1) {
    expect((await gate('POST', undefined, 'reset')).allowed).toBe(true);
  }
  expect(await gate('POST', undefined, 'reset')).toEqual({ allowed: false, status: 429 });
  expect((await gate()).allowed).toBe(true);
});

it('stops writes when the database reaches its size cap', async () => {
  process.env.DEMO_MAX_DATABASE_MB = '5';
  expect(await gate()).toEqual({ allowed: false, status: 507 });
  expect((await gate('GET')).allowed).toBe(true);
});

it('applies the gate to every route that checks identity', async () => {
  for (let i = 0; i < 60; i += 1) {
    await gate();
  }
  const { req, res } = request();
  expect(await requireIdentity(req as any, res as any, true)).toBeNull();
  expect(res._getStatusCode()).toBe(429);
});

it('adds only fictional students to the demo roster', async () => {
  const add = async (email: string) => {
    const { req, res } = request('POST', '203.0.113.9', { courseId: 'course', email });
    await rosterRoute(req as any, res as any);
    return res._getStatusCode();
  };
  (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'new' });
  expect(await add('someone@bu.edu')).toBe(400);
  expect(prisma.user.upsert).not.toHaveBeenCalled();
  expect(await add('newcomer@demo.checkhen.invalid')).toBe(200);
});

it('adds no courses in demo mode', async () => {
  const { req, res } = request('POST', '203.0.113.9', { name: 'Demo: Farm Science 101' });
  await coursesRoute(req as any, res as any);
  expect(res._getStatusCode()).toBe(403);
  expect(prisma.course.create).not.toHaveBeenCalled();
});

it('takes no profile photos in demo mode', async () => {
  const { req, res } = request('POST', '203.0.113.9', { imageBase64: 'data:image/png;base64,AA' });
  await uploadRoute(req as any, res as any);
  expect(res._getStatusCode()).toBe(403);
  expect(prisma.user.update).not.toHaveBeenCalled();
});
