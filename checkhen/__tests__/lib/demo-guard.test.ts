import { getServerSession } from 'next-auth';
import { createMocks } from 'node-mocks-http';
import { DEMO_INSTRUCTOR } from '@/lib/demo';
import { clientKey, demoGate, demoLimitKeys, resetDemoLimits } from '@/lib/demo-guard';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';
import templatesRoute from '@/pages/api/admin/class-templates';
import eventsRoute from '@/pages/api/admin/events';
import profileRoute from '@/pages/api/admin/get-student-profile';
import rosterRoute from '@/pages/api/admin/roster';
import newClassRoute from '@/pages/api/admin/start-new-class';
import isAdminRoute from '@/pages/api/auth/is-admin';
import coursesRoute from '@/pages/api/courses';
import uploadRoute from '@/pages/api/student/upload-profile-picture';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    user: { count: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    course: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    rosterEntry: { upsert: jest.fn() },
    classTemplate: { count: jest.fn(), create: jest.fn() },
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
  const allowed = await demoGate(req as any, res as any, { bucket });
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

it('treats the demo instructor as an instructor on every admin route', async () => {
  const profile = request('GET', '203.0.113.9');
  profile.req.query = { email: 'clover@demo.checkhen.invalid' };
  await profileRoute(profile.req as any, profile.res as any);
  expect(profile.res._getStatusCode()).toBe(200);
  const admin = request('GET', '203.0.113.9');
  await isAdminRoute(admin.req as any, admin.res as any);
  expect(admin.res._getJSONData()).toEqual({ isAdmin: true });
});

it('refuses raw events from demo visitors', async () => {
  const { req, res } = request('POST', '203.0.113.9', {
    kind: 'CHAT_MESSAGE',
    payload: { message: 'x'.repeat(100000), anonymousName: 'Swift Panda' },
  });
  req.query = { courseId: 'course', classId: 'class' };
  (prisma as any).class = { findFirst: jest.fn().mockResolvedValue({ id: 'class' }) };
  await eventsRoute(req as any, res as any);
  expect(res._getStatusCode()).toBe(403);
});

it('refuses a roster address longer than an email can be', async () => {
  const { req, res } = request('POST', '203.0.113.9', {
    courseId: 'course',
    email: `${'x'.repeat(260)}@demo.checkhen.invalid`,
  });
  await rosterRoute(req as any, res as any);
  expect(res._getStatusCode()).toBe(400);
  expect(prisma.user.upsert).not.toHaveBeenCalled();
});

it('lets a reset through at the size cap, within the reset limit', async () => {
  process.env.DEMO_MAX_DATABASE_MB = '5';
  const write = request();
  expect(await requireIdentity(write.req as any, write.res as any, true)).toBeNull();
  expect(write.res._getStatusCode()).toBe(507);
  for (let i = 0; i < 3; i += 1) {
    const reset = request();
    expect(
      await requireIdentity(reset.req as any, reset.res as any, true, {
        bucket: 'reset',
        pastSizeCap: true,
      })
    ).not.toBeNull();
  }
  const fourth = request();
  expect(
    await requireIdentity(fourth.req as any, fourth.res as any, true, {
      bucket: 'reset',
      pastSizeCap: true,
    })
  ).toBeNull();
  expect(fourth.res._getStatusCode()).toBe(429);
});

describe('class schedules', () => {
  const template = {
    courseId: 'course',
    name: 'Lecture',
    color: '#0066ff',
    duration: 75,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '10:00',
  };
  const post = async () => {
    const { req, res } = request('POST', '203.0.113.9', template);
    await templatesRoute(req as any, res as any);
    return res._getStatusCode();
  };

  it('takes none in demo mode', async () => {
    expect(await post()).toBe(403);
    expect(prisma.classTemplate.create).not.toHaveBeenCalled();
  });

  it('allows at most fifty per course in any mode', async () => {
    process.env.CHECKHEN_MODE = 'classroom';
    process.env.ADMIN_EMAILS = DEMO_INSTRUCTOR;
    (prisma.classTemplate.create as jest.Mock).mockResolvedValue({
      ...template,
      id: 't',
      tz: 'America/New_York',
      createdAt: new Date(),
    });
    (prisma.classTemplate.count as jest.Mock).mockResolvedValue(49);
    expect(await post()).toBe(201);
    (prisma.classTemplate.count as jest.Mock).mockResolvedValue(50);
    expect(await post()).toBe(400);
    delete process.env.ADMIN_EMAILS;
  });
});

it('does not let one client use up the shared limit', async () => {
  for (let i = 0; i < 700; i += 1) {
    await gate('POST', '203.0.113.5');
  }
  // 640 of those were over the client's own limit and never reached the shared one.
  expect((await gate('POST', '198.51.100.7')).allowed).toBe(true);
  for (let i = 0; i < 3; i += 1) {
    await gate('POST', '203.0.113.5', 'reset');
  }
  for (let i = 0; i < 20; i += 1) {
    await gate('POST', '203.0.113.5', 'reset');
  }
  expect((await gate('POST', '198.51.100.7', 'reset')).allowed).toBe(true);
});

it('keys an IPv6 client by its /64', async () => {
  const key = (ip: string) => clientKey(request('POST', ip).req as any);
  expect(key('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
  expect(key('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
  expect(key('2001:db8::1')).toBe('2001:db8:0:0::/64');
  expect(key('2001:db8:1:3::1')).not.toBe(key('2001:db8:1:2::1'));
  expect(key('203.0.113.5')).toBe('203.0.113.5');
  for (let i = 0; i < 60; i += 1) {
    await gate('POST', `2001:db8:1:2::${i.toString(16)}`);
  }
  expect(await gate('POST', '2001:db8:1:2::ffff')).toEqual({ allowed: false, status: 429 });
});

describe('counter memory', () => {
  afterEach(() => jest.useRealTimers());

  it('stops adding clients at the counter limit, so memory stays bounded', async () => {
    for (let i = 0; i < 10_050; i += 1) {
      await gate('POST', `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    }
    expect(demoLimitKeys()).toBeLessThanOrEqual(10_000);
    expect((await gate('POST', '192.0.2.200')).status).toBe(429);
  });

  it('keeps hourly reset counters when write counters expire', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-09T12:00:00Z') });
    for (let i = 0; i < 3; i += 1) {
      await gate('POST', '203.0.113.5', 'reset');
    }
    for (let i = 0; i < 9_997; i += 1) {
      await gate('POST', `10.0.${(i >> 8) & 255}.${i & 255}`);
    }
    jest.setSystemTime(Date.parse('2026-10-09T12:02:00Z'));
    // The prune clears the expired write counters but not the reset counter.
    await gate('POST', '198.51.100.9');
    expect(await gate('POST', '203.0.113.5', 'reset')).toEqual({ allowed: false, status: 429 });
  });
});

it('checks the database for demo-only data at most every five seconds', async () => {
  for (let i = 0; i < 20; i += 1) {
    await gate('GET');
  }
  expect(prisma.user.count).toHaveBeenCalledTimes(1);
  expect(prisma.course.count).toHaveBeenCalledTimes(1);
});

it('starts no new classes in demo mode', async () => {
  const { req, res } = request('POST', '203.0.113.9', {
    courseId: 'course',
    name: 'Extra',
    duration: 480,
  });
  await newClassRoute(req as any, res as any);
  expect(res._getStatusCode()).toBe(403);
});

describe('the limiter cannot be turned into a lockout', () => {
  afterEach(() => jest.useRealTimers());

  it('uses no counter for a request that is not signed in', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const { req, res } = request();
    expect(await requireIdentity(req as any, res as any, true, { bucket: 'reset' })).toBeNull();
    expect(res._getStatusCode()).toBe(401);
    expect(demoLimitKeys()).toBe(0);
  });

  it('keeps writes open after a flood of reset attempts fills the counter table', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-09T12:00:00Z') });
    for (let i = 0; i < 10_000; i += 1) {
      await gate('POST', `2001:db8:${i.toString(16)}::1`, 'reset');
    }
    // A minute later the shared write limit renews and a new visitor can write.
    jest.setSystemTime(Date.parse('2026-10-09T12:01:01Z'));
    expect(await gate('POST', '198.51.100.20')).toEqual({ allowed: true, status: 200 });
    expect(demoLimitKeys()).toBeLessThanOrEqual(10_000);
  });

  it('counts resets per IPv6 /48', async () => {
    for (let i = 0; i < 3; i += 1) {
      await gate('POST', `2001:db8:7:${i}::1`, 'reset');
    }
    expect(await gate('POST', '2001:db8:7:99::1', 'reset')).toEqual({
      allowed: false,
      status: 429,
    });
    expect(clientKey(request('POST', '2001:db8:7:99::1').req as any, 3)).toBe('2001:db8:7::/48');
  });
});
