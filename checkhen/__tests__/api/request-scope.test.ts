import { createMocks } from 'node-mocks-http';
import { requireScope } from '@/lib/request-scope';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: jest.fn() },
  class: { findFirst: jest.fn() },
  rosterEntry: { findUnique: jest.fn() },
} }));
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_EMAIL_DOMAIN = 'bu.edu';
  process.env.ADMIN_EMAILS = 'instructor';
  (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'student@bu.edu' } });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'student', email: 'student@bu.edu' });
  (prisma.class.findFirst as jest.Mock).mockResolvedValue({ id: 'session-a', courseId: 'course-a' });
  (prisma.rosterEntry.findUnique as jest.Mock).mockResolvedValue({ active: true });
});
const invoke = async (courseId: string, classId: string) => {
  const { req, res } = createMocks({ method: 'GET', query: { courseId, classId } });
  const result = await requireScope(req as any, res as any);
  return { result, res };
};
it('rejects a cross-course session even when the class ID exists elsewhere', async () => {
  (prisma.class.findFirst as jest.Mock).mockResolvedValue(null);
  const { result, res } = await invoke('course-b', 'session-a');
  expect(result).toBeNull();
  expect(res._getStatusCode()).toBe(404);
  expect(prisma.class.findFirst).toHaveBeenCalledWith({ where: { id: 'session-a', courseId: 'course-b' } });
});
it('rejects a student who is not active on the selected course roster', async () => {
  (prisma.rosterEntry.findUnique as jest.Mock).mockResolvedValue({ active: false });
  const { result, res } = await invoke('course-a', 'session-a');
  expect(result).toBeNull();
  expect(res._getStatusCode()).toBe(403);
});
it('returns only the explicitly selected course and session', async () => {
  const { result } = await invoke('course-a', 'session-a');
  expect(result?.scope).toEqual({ courseId: 'course-a', classId: 'session-a' });
});
it('requires an authenticated session', async () => {
  (getServerSession as jest.Mock).mockResolvedValue(null);
  const { result, res } = await invoke('course-a', 'session-a');
  expect(result).toBeNull();
  expect(res._getStatusCode()).toBe(401);
});
