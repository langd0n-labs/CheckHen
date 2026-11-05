beforeEach(() => { process.env.NEXTAUTH_URL = 'https://checkhen.test'; });
import { createMocks } from 'node-mocks-http';
import * as nextAuth from 'next-auth';
import { prisma } from '@/lib/prisma';
import { requireIdentity } from '@/lib/request-scope';
import roster from '@/pages/api/admin/roster';
import studentProfile from '@/pages/api/admin/get-student-profile';
import ownProfile from '@/pages/api/student/get-profile';

jest.mock('next-auth', () => ({ __esModule: true, default: () => jest.fn(), getServerSession: jest.fn() }));
jest.mock('@/pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('@/lib/request-scope', () => ({ requireIdentity: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    course: { findUnique: jest.fn() },
    rosterEntry: { findMany: jest.fn() },
  },
}));

// A value stored before the field was removed must not reach anyone.
const stored = { email: 'student@bu.edu', bio: 'Hello', foodAllergies: 'peanuts' };

beforeEach(() => {
  jest.clearAllMocks();
  (requireIdentity as jest.Mock).mockResolvedValue({ email: 'prof@bu.edu', deploymentInstructor: true });
  (nextAuth.getServerSession as jest.Mock).mockResolvedValue({ user: { email: stored.email } });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(stored);
});

describe('food allergies are not shown', () => {
  it.each([
    ['the student profile page', ownProfile, {}],
    ['the instructor profile modal', studentProfile, { email: stored.email }],
  ])('%s neither reads nor returns them', async (_name, handler, query) => {
    const { req, res } = createMocks({ headers: { origin: 'https://checkhen.test', 'content-type': 'application/json' }, method: 'GET', query });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    const { select } = (prisma.user.findUnique as jest.Mock).mock.calls[0][0];
    expect(select).not.toHaveProperty('foodAllergies');
    expect(res._getJSONData()).not.toHaveProperty('foodAllergies');
  });

  it('the roster asks the database to leave them out', async () => {
    (prisma.course.findUnique as jest.Mock).mockResolvedValue({ id: 'course-a' });
    (prisma.rosterEntry.findMany as jest.Mock).mockResolvedValue([]);
    const { req, res } = createMocks({ headers: { origin: 'https://checkhen.test', 'content-type': 'application/json' }, method: 'GET', query: { courseId: 'course-a' } });
    await roster(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(prisma.rosterEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { user: { omit: { foodAllergies: true } } } })
    );
  });
});
