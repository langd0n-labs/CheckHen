import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/admin/fetch-analytics';
import { readState } from '@/lib/event-store';

jest.mock('@/lib/request-scope', () => ({
  requireIdentity: jest.fn().mockResolvedValue({ admin: true }),
  isInstructor: jest.fn(() => false),
}));
jest.mock('@/lib/staff', () => ({ courseStaffIds: jest.fn().mockResolvedValue(new Set()) }));
jest.mock('@/lib/event-store', () => ({ readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {
  course: { findUnique: jest.fn().mockResolvedValue({ id: 'course' }) },
  class: { findMany: jest.fn().mockResolvedValue([{ id: 'class', name: 'Class', createdAt: new Date('2026-11-05T12:00:00Z'), duration: 60, color: null }]) },
  classTemplate: { findMany: jest.fn().mockResolvedValue([]) },
  user: { findMany: jest.fn().mockResolvedValue([{ id: 'student', email: 'student@example.edu', name: 'Student', displayName: null }]) },
} }));

it.each([null, 'student'])('excludes instructor messages from student participation when author is %s', async (userId) => {
  (readState as jest.Mock).mockResolvedValue({
    attendance: [{ userId: 'student', anonymousName: 'Swift Panda', createdAt: new Date('2026-11-05T12:00:00Z'), checkOutTime: null }],
    hands: [], pace: [],
    messages: [{ userId: 'student' }, { userId, fromInstructor: true }],
  });
  const { req, res } = createMocks({ method: 'GET', query: { courseId: 'course', classId: 'class' } });
  await handler(req as any, res as any);
  expect(res._getStatusCode()).toBe(200);
  expect(res._getJSONData().aggregated.avgMessagesPerStudent).toBe(1);
});
