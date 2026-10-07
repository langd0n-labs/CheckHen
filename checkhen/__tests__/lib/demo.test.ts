import { avatar, DEMO_DOMAIN, DEMO_INSTRUCTOR, DEMO_STUDENTS, isDemo } from '@/lib/demo';
import { isInstructor } from '@/lib/request-scope';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

afterEach(() => {
  delete process.env.CHECKHEN_DEMO;
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
  expect(isDemo()).toBe(true);
  expect(isInstructor(DEMO_INSTRUCTOR)).toBe(true);
  expect(isInstructor('prof@bu.edu')).toBe(false);
});
