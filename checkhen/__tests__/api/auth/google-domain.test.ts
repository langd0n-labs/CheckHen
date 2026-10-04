import { prisma } from '@/lib/prisma';
import { authOptions } from '@/pages/api/auth/[...nextauth]';

jest.mock('next-auth', () => jest.fn());
jest.mock('next-auth/providers/google', () => jest.fn(() => ({})));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { upsert: jest.fn() } } }));

const signIn = (authOptions.callbacks as any).signIn;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_EMAIL_DOMAIN = 'bu.edu';
});

describe('Google Workspace sign-in', () => {
  it('accepts a verified BU Workspace identity', async () => {
    expect(
      await signIn({
        user: { email: 'student@bu.edu', image: null },
        profile: { email_verified: true, hd: 'bu.edu' },
      })
    ).toBe(true);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['personal Google account using a BU email', 'student@bu.edu', { email_verified: true }],
    ['unverified BU email', 'student@bu.edu', { email_verified: false, hd: 'bu.edu' }],
    ['other Workspace domain', 'student@other.edu', { email_verified: true, hd: 'other.edu' }],
  ])('rejects %s', async (_label, email, profile) => {
    expect(await signIn({ user: { email }, profile })).toBe(false);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
