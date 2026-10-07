import { createMocks } from 'node-mocks-http';
import { getServerSession } from 'next-auth';
import {
  avatar,
  DEMO_DATABASE_REFUSED,
  DEMO_DOMAIN,
  DEMO_INSTRUCTOR,
  DEMO_STUDENTS,
  demoDatabaseProblem,
  isDemo,
} from '@/lib/demo';
import { prisma } from '@/lib/prisma';
import { isInstructor, requireIdentity } from '@/lib/request-scope';

jest.mock('@/lib/prisma', () => ({
  prisma: { user: { count: jest.fn(), findUnique: jest.fn() }, course: { count: jest.fn() } },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

beforeEach(() => {
  (prisma.user.count as jest.Mock).mockResolvedValue(0);
  (prisma.course.count as jest.Mock).mockResolvedValue(0);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'hoot', email: DEMO_INSTRUCTOR });
  (getServerSession as jest.Mock).mockResolvedValue({ user: { email: DEMO_INSTRUCTOR } });
});

afterEach(() => {
  delete process.env.CHECKHEN_DEMO;
  delete process.env.CHECKHEN_MODE;
  delete process.env.ADMIN_EMAILS;
});

it('uses only fictional demo addresses', () => {
  for (const student of DEMO_STUDENTS) {
    expect(student.email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true);
  }
  // .invalid is reserved and never routes, so no demo address reaches a real inbox.
  expect(DEMO_DOMAIN.endsWith('.invalid')).toBe(true);
});

it('draws each avatar as a generated image', () => {
  expect(avatar(DEMO_STUDENTS[0])).toMatch(/^data:image\/svg\+xml;utf8,/);
});

it('makes only the demo instructor an instructor in demo mode', () => {
  process.env.ADMIN_EMAILS = 'prof@bu.edu';
  expect(isInstructor('prof@bu.edu')).toBe(true);
  expect(isInstructor(DEMO_INSTRUCTOR)).toBe(false);
  process.env.CHECKHEN_DEMO = '1';
  process.env.CHECKHEN_MODE = 'hosted';
  expect(isDemo()).toBe(true);
  expect(isInstructor(DEMO_INSTRUCTOR)).toBe(true);
  expect(isInstructor('prof@bu.edu')).toBe(false);
});

it('refuses demo mode in classroom mode', () => {
  process.env.CHECKHEN_DEMO = '1';
  expect(isDemo()).toBe(false);
  process.env.ADMIN_EMAILS = 'prof@bu.edu';
  // Classroom mode keeps its real instructors, and the demo persona is no one.
  expect(isInstructor('prof@bu.edu')).toBe(true);
  expect(isInstructor(DEMO_INSTRUCTOR)).toBe(false);
});

describe('a database with real data', () => {
  beforeEach(() => {
    process.env.CHECKHEN_DEMO = '1';
    process.env.CHECKHEN_MODE = 'hosted';
  });

  it('accepts a database that holds only demo data', async () => {
    expect(await demoDatabaseProblem(prisma as any)).toBeNull();
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { NOT: { email: { endsWith: `@${DEMO_DOMAIN}` } } },
    });
    expect(prisma.course.count).toHaveBeenCalledWith({ where: { demo: false } });
  });

  it('refuses a real course or a real user', async () => {
    (prisma.course.count as jest.Mock).mockResolvedValueOnce(1);
    expect(await demoDatabaseProblem(prisma as any)).toBe(DEMO_DATABASE_REFUSED);
    (prisma.user.count as jest.Mock).mockResolvedValueOnce(1);
    expect(await demoDatabaseProblem(prisma as any)).toBe(DEMO_DATABASE_REFUSED);
  });

  it('turns away every request, even the demo instructor', async () => {
    (prisma.course.count as jest.Mock).mockResolvedValue(1);
    const { req, res } = createMocks({ method: 'GET' });
    expect(await requireIdentity(req as any, res as any, true)).toBeNull();
    expect(res._getStatusCode()).toBe(503);
    expect(res._getJSONData().message).toBe(DEMO_DATABASE_REFUSED);
  });

  it('lets the demo instructor in on a demo-only database', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    expect(await requireIdentity(req as any, res as any, true)).toMatchObject({ admin: true });
  });
});
