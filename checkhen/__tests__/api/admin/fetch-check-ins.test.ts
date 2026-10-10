import { createMocks } from 'node-mocks-http';
import { readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { isInstructor, requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/admin/fetch-check-ins';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn(), isInstructor: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: jest.fn() } } }));
const admin = { id: 'admin', email: 'prof@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const student = { id: 'student', email: 'student@bu.edu' };
const secondStudent = { id: 'second-student', email: 'second@bu.edu' };
const state = {
  attendance: [
    {
      id: 'checkin-1',
      userId: 'student',
      classId: 'session-a',
      anonymousName: 'Swift Panda',
      createdAt: new Date(),
      isPresent: true,
    },
    {
      id: 'checkin-2',
      userId: secondStudent.id,
      classId: 'session-a',
      anonymousName: 'Calm Otter',
      createdAt: new Date(),
      isPresent: true,
    },
  ],
  hands: [
    { id: 'hand-1', userId: 'student' },
    { id: 'hand-2', userId: 'student' },
  ],
  pace: [],
  messages: [],
  endedAt: null,
};
const invoke = async (method: 'GET' | 'POST' = 'GET', currentState = state, users = [student, secondStudent]) => {
  (readState as jest.Mock).mockResolvedValue(currentState);
  (prisma.user.findMany as jest.Mock).mockResolvedValue(users);
  const { req, res } = createMocks({ method, query: scope });
  await handler(req as any, res as any);
  return res;
};
beforeEach(() => {
  jest.clearAllMocks();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user: admin, selected, admin: true });
  (isInstructor as jest.Mock).mockReturnValue(false);
});
describe('GET /api/admin/fetch-check-ins', () => {
  it('rejects wrong methods', async () =>
    expect((await invoke('POST'))._getStatusCode()).toBe(405));
  it('returns 401 without a session', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(401).json({ message: 'Unauthorized' }); return null; });
    expect((await invoke())._getStatusCode()).toBe(401);
  });
  it('propagates a 403 from scope authorization', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => {
      res.status(403).json({ message: 'Instructor access required' });
      return null;
    });
    const res = await invoke();
    expect(res._getStatusCode()).toBe(403);
    expect(requireScope).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  });
  it('reports each student attendance and hand-raise count from event state', async () => {
    const res = await invoke();
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getJSONData().message)).toEqual([
      expect.objectContaining({
        email: 'student@bu.edu',
        handRaiseCount: 2,
        anonymousName: 'Swift Panda',
      }),
      expect.objectContaining({
        email: 'second@bu.edu',
        handRaiseCount: 0,
        anonymousName: 'Calm Otter',
      }),
    ]);
    expect(readState).toHaveBeenCalledWith(prisma, scope);
  });
  it('returns an empty array for no attendance', async () => {
    const res = await invoke('GET', { ...state, attendance: [] });
    expect(JSON.parse(res._getJSONData().message)).toEqual([]);
  });
  it('includes the expected fields and derives name from email', async () => {
    const res = await invoke('GET', state, [{ id: 'student', email: 'jsmith@bu.edu' }, secondStudent]);
    const entry = JSON.parse(res._getJSONData().message)[0];
    for (const key of ['id', 'email', 'name', 'anonymousName', 'joinTime', 'handRaiseCount', 'userId', 'user']) {
      expect(entry).toHaveProperty(key);
    }
    expect(entry.name).toBe('jsmith');
  });
  it('excludes instructor attendance from the result', async () => {
    (isInstructor as jest.Mock).mockImplementation((email: string) => email === student.email);
    const res = await invoke();
    expect(JSON.parse(res._getJSONData().message)).toHaveLength(1);
    expect(JSON.parse(res._getJSONData().message)[0].email).toBe(secondStudent.email);
  });
});
