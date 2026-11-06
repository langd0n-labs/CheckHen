import { prisma } from '@/lib/prisma';
import { authOptions } from '@/pages/api/auth/[...nextauth]';

jest.mock('next-auth', () => jest.fn());
jest.mock('next-auth/providers/google', () => jest.fn(() => ({})));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { upsert: jest.fn(), updateMany: jest.fn() } },
}));

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
        profile: { email_verified: true, hd: 'bu.edu', name: 'Alice Canonical' },
      })
    ).toBe(true);
    expect(prisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { name: 'Alice Canonical' },
      create: expect.objectContaining({ name: 'Alice Canonical' }),
    }));
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

it('fills only a null photo after saving the Google name', async () => {
  await signIn({
    user: { email: 'student@bu.edu', image: 'https://example.com/photo.jpg' },
    profile: { email_verified: true, hd: 'bu.edu', name: 'Student Name' },
  });
  expect(prisma.user.updateMany).toHaveBeenCalledWith({
    where: { email: 'student@bu.edu', profilePicture: null },
    data: { profilePicture: 'https://example.com/photo.jpg' },
  });
});
it('skips the photo update when Google supplies no image', async () => {
  await signIn({
    user: { email: 'student@bu.edu' },
    profile: { email_verified: true, hd: 'bu.edu' },
  });
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
});

it.each([null, 'https://example.com/upload.jpg'])(
  'preserves existing photos and fills a roster-only user (%s)',
  async (photo) => {
    const stored = { name: null as string | null, profilePicture: photo };
    (prisma.user.upsert as jest.Mock).mockImplementationOnce(async ({ update }) =>
      Object.assign(stored, update)
    );
    (prisma.user.updateMany as jest.Mock).mockImplementationOnce(async ({ where, data }) => {
      if (stored.profilePicture === where.profilePicture) Object.assign(stored, data);
      return { count: 1 };
    });
    await signIn({
      user: { email: 'student@bu.edu', image: 'https://example.com/google.jpg' },
      profile: { email_verified: true, hd: 'bu.edu', name: 'Student Name' },
    });
    expect(stored).toEqual({
      name: 'Student Name',
      profilePicture: photo ?? 'https://example.com/google.jpg',
    });
  }
);
