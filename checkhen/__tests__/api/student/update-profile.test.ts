jest.mock('next-auth', () => {
  const mockGetServerSession = jest.fn();
  return {
    __esModule: true,
    default: () => jest.fn(),
    getServerSession: mockGetServerSession,
  };
});

jest.mock('@/pages/api/auth/[...nextauth]', () => ({
  authOptions: {},
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { update: jest.fn() },
  },
}));

import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/student/update-profile';
import * as nextAuth from 'next-auth';
import { prisma } from '@/lib/prisma';

const mockSession = (email = 'student@bu.edu') =>
  (nextAuth.getServerSession as jest.Mock).mockResolvedValue({ user: { email } });

const mockNoSession = () =>
  (nextAuth.getServerSession as jest.Mock).mockResolvedValue(null);

afterEach(() => jest.clearAllMocks());

describe('POST /api/student/update-profile', () => {
  it('returns 405 for non-POST requests', async () => {
    mockNoSession();
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 401 if no session', async () => {
    mockNoSession();
    const { req, res } = createMocks({ method: 'POST', body: {} });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 400 if bio exceeds 280 characters', async () => {
    mockSession();
    const { req, res } = createMocks({ method: 'POST', body: { bio: 'x'.repeat(281) } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('accepts bio of exactly 280 characters', async () => {
    mockSession();
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST', body: { bio: 'x'.repeat(280) } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
  });

  it('calls user.update with all provided fields', async () => {
    mockSession();
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    const body = {
      displayName: 'Alice',
      namePronunciation: 'AL-iss',
      pronouns: 'she/her',
      foodAllergies: 'peanuts',
      bio: 'Hello!',
    };
    const { req, res } = createMocks({ method: 'POST', body });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: 'student@bu.edu' },
      data: {
        displayName: 'Alice',
        namePronunciation: 'AL-iss',
        pronouns: 'she/her',
        foodAllergies: 'peanuts',
        bio: 'Hello!',
      },
    });
  });

  it('passes null for all fields when body is empty', async () => {
    mockSession();
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST', body: {} });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: 'student@bu.edu' },
      data: {
        displayName: null,
        namePronunciation: null,
        pronouns: null,
        foodAllergies: null,
        bio: null,
      },
    });
  });

  it('coerces empty string displayName to null (via || null)', async () => {
    mockSession();
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST', body: { displayName: '' } });
    await handler(req as any, res as any);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: null }) })
    );
  });

  it('preserves empty string for foodAllergies (uses ?? null, not || null)', async () => {
    mockSession();
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST', body: { foodAllergies: '' } });
    await handler(req as any, res as any);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ foodAllergies: '' }) })
    );
  });

  it('refuses a displayName longer than 100 characters', async () => {
    mockSession();
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST', body: { displayName: 'x'.repeat(500) } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });
});

describe('profile field limits', () => {
  it.each([
    ['displayName', 80],
    ['namePronunciation', 80],
    ['pronouns', 40],
    ['foodAllergies', 200],
  ])('refuses a %s longer than %i characters', async (field, max) => {
    mockSession();
    const { req, res } = createMocks({ method: 'POST', body: { [field]: 'x'.repeat(max + 1) } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
