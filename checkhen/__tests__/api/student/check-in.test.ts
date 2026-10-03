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
    user: { upsert: jest.fn() },
    class: { findFirst: jest.fn() },
    checkIn: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/anonymousNames', () => ({
  generateUniqueAnonymousName: jest.fn().mockReturnValue('Brave Panda'),
}));

import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/student/check-in';
import * as nextAuth from 'next-auth';
import { prisma } from '@/lib/prisma';
import { generateUniqueAnonymousName } from '@/lib/anonymousNames';

const activeClass = () => ({
  id: 'class-1',
  createdAt: new Date(),
  duration: 9999,
});

const expiredClass = () => ({
  id: 'class-old',
  createdAt: new Date(0),
  duration: 1,
});

const mockSession = (email = 'student@bu.edu') =>
  (nextAuth.getServerSession as jest.Mock).mockResolvedValue({ user: { email } });

const mockNoSession = () =>
  (nextAuth.getServerSession as jest.Mock).mockResolvedValue(null);

afterEach(() => jest.clearAllMocks());

describe('POST /api/student/check-in', () => {
  it('returns 405 for non-POST requests', async () => {
    mockNoSession();
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 401 if no session', async () => {
    mockNoSession();
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 500 if no class found', async () => {
    mockSession();
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'student@bu.edu' });
    (prisma.class.findFirst as jest.Mock).mockResolvedValue(null);
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(500);
  });

  it('returns 400 if class has ended', async () => {
    mockSession();
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'student@bu.edu' });
    (prisma.class.findFirst as jest.Mock).mockResolvedValue(expiredClass());
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 200 and restores presence when student previously checked out', async () => {
    mockSession();
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'student@bu.edu' });
    (prisma.class.findFirst as jest.Mock).mockResolvedValue(activeClass());
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue({ id: 'ci-1', isPresent: false });
    (prisma.checkIn.update as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(prisma.checkIn.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { isPresent: true, checkOutTime: null },
    });
  });

  it('returns 200 immediately when already checked in and present, without calling update', async () => {
    mockSession();
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'student@bu.edu' });
    (prisma.class.findFirst as jest.Mock).mockResolvedValue(activeClass());
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue({ id: 'ci-1', isPresent: true });
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(prisma.checkIn.update).not.toHaveBeenCalled();
  });

  it('creates a new check-in and returns 200', async () => {
    mockSession();
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'student@bu.edu' });
    (prisma.class.findFirst as jest.Mock).mockResolvedValue(activeClass());
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.checkIn.create as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(prisma.checkIn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          classId: 'class-1',
          anonymousName: 'Brave Panda',
        }),
      })
    );
  });

  it('passes filtered existing names (nulls excluded) to generateUniqueAnonymousName', async () => {
    mockSession();
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'student@bu.edu' });
    (prisma.class.findFirst as jest.Mock).mockResolvedValue(activeClass());
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
      { anonymousName: 'Brave Panda' },
      { anonymousName: null },
      { anonymousName: 'Clever Fox' },
    ]);
    (prisma.checkIn.create as jest.Mock).mockResolvedValue({});
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req as any, res as any);
    expect(generateUniqueAnonymousName).toHaveBeenCalledWith(['Brave Panda', 'Clever Fox']);
  });
});
