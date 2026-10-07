import { DEMO_INSTRUCTOR } from '@/lib/demo';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth', () => jest.fn());
jest.mock('next-auth/providers/google', () => jest.fn(() => ({ id: 'google' })));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(), count: jest.fn() }, course: { count: jest.fn() } },
}));

/** The providers are chosen when the module loads, so load it under each mode. */
function loadAuth(mode: 'hosted' | 'classroom') {
  process.env.CHECKHEN_DEMO = '1';
  process.env.CHECKHEN_MODE = mode;
  let options: any;
  jest.isolateModules(() => {
    options = require('@/pages/api/auth/[...nextauth]').authOptions;
  });
  return options;
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.count as jest.Mock).mockResolvedValue(0);
  (prisma.course.count as jest.Mock).mockResolvedValue(0);
  (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: any) =>
    where.email === DEMO_INSTRUCTOR
      ? { id: 'hoot', email: DEMO_INSTRUCTOR, displayName: 'Hoot' }
      : null
  );
});

afterEach(() => {
  delete process.env.CHECKHEN_DEMO;
  delete process.env.CHECKHEN_MODE;
});

const authorize = (options: any, email: string) =>
  options.providers[0].options.authorize({ email }, {});

it('signs in an existing demo persona', async () => {
  const options = loadAuth('hosted');
  // next-auth merges a credentials provider's own options, including its id, at runtime.
  expect(options.providers.map((provider: any) => provider.options.id)).toEqual(['demo']);
  expect(await authorize(options, DEMO_INSTRUCTOR)).toMatchObject({ email: DEMO_INSTRUCTOR });
});

it('refuses an address outside the demo domain, even one that exists', async () => {
  const options = loadAuth('hosted');
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'real', email: 'prof@bu.edu' });
  expect(await authorize(options, 'prof@bu.edu')).toBeNull();
  expect(await authorize(options, 'prof@bu.edu.demo.checkhen.invalid.example')).toBeNull();
  expect(await options.callbacks.signIn({ user: { email: 'prof@bu.edu' }, profile: {} })).toBe(
    false
  );
});

it('refuses a demo address with no persona', async () => {
  expect(await authorize(loadAuth('hosted'), 'nobody@demo.checkhen.invalid')).toBeNull();
});

it('refuses every persona on a database with real data', async () => {
  const options = loadAuth('hosted');
  (prisma.course.count as jest.Mock).mockResolvedValue(1);
  expect(await authorize(options, DEMO_INSTRUCTOR)).toBeNull();
});

it('keeps Google sign-in in classroom mode', () => {
  expect(loadAuth('classroom').providers.map((provider: any) => provider.id)).toEqual(['google']);
});
