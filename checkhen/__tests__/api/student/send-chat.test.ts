beforeEach(() => { process.env.NEXTAUTH_URL = 'https://checkhen.test'; });
import { createMocks } from 'node-mocks-http';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import { isCourseStaff } from '@/lib/staff';
import { resetWriteLimits } from '@/lib/write-limits';
import { DEMO_STUDENTS } from '@/lib/demo';
import { isInstructor } from '@/lib/instructor';
import handler from '@/pages/api/student/send-chat';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { rosterEntry: { findUnique: jest.fn() } } }));
jest.mock('@/lib/staff', () => ({ isCourseStaff: jest.fn() }));
const user = { id: 'student', email: 'student@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const checkedIn = () => ({
  attendance: [{ userId: user.id, anonymousName: 'Swift Panda', isPresent: true }],
  hands: [],
  pace: [],
  messages: [],
  endedAt: null as Date | null,
});
const invoke = async (
  body: Record<string, unknown>,
  state = checkedIn(),
  method: 'GET' | 'POST' = 'POST'
) => {
  (readState as jest.Mock).mockResolvedValue(state);
  const { req, res } = createMocks({ headers: { origin: 'https://checkhen.test', 'content-type': 'application/json' }, method, body, query: scope });
  await handler(req as any, res as any);
  return res;
};
beforeEach(() => {
  jest.clearAllMocks();
  resetWriteLimits();
  (isCourseStaff as jest.Mock).mockResolvedValue(false);
  (prisma.rosterEntry.findUnique as jest.Mock).mockResolvedValue(null);
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: false });
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
});
describe('POST /api/student/send-chat', () => {
  it.each([
    ['deployment instructor without roster', true, false, null, 403],
    ['deployment instructor with active roster', true, false, { active: true }, 200],
    ['deployment instructor with inactive roster', true, false, { active: false }, 403],
    ['course staff without roster', false, true, null, 403],
    ['course staff with active roster', false, true, { active: true }, 403],
    ['deployment instructor who is also course staff', true, true, { active: true }, 403],
    ['student who instructs another course', false, false, { active: true }, 200],
    ['student', false, false, { active: true }, 200],
  ])('%s', async (_label, deploymentInstructor, staff, roster, status) => {
    (requireScope as jest.Mock).mockResolvedValue({
      scope, user, selected, admin: deploymentInstructor || staff, deploymentInstructor,
    });
    (isCourseStaff as jest.Mock).mockResolvedValue(staff);
    (prisma.rosterEntry.findUnique as jest.Mock).mockResolvedValue(roster);
    const res = await invoke({ message: 'hello' });
    expect(isCourseStaff).toHaveBeenCalledWith(user.id, scope.courseId);
    expect(res._getStatusCode()).toBe(status);
    if (status === 403) {
      expect(res._getJSONData()).toEqual({
        message: 'Instructors cannot post anonymous messages in this course',
      });
      expect(appendEvent).not.toHaveBeenCalled();
    } else {
      expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'CHAT_MESSAGE' }));
    }
  });
  it('allows a demo student persona even if ADMIN_EMAILS lists it', async () => {
    const previousMode = process.env.CHECKHEN_MODE;
    process.env.CHECKHEN_MODE = 'hosted';
    const previousDemo = process.env.CHECKHEN_DEMO;
    const previousAdmins = process.env.ADMIN_EMAILS;
    process.env.CHECKHEN_DEMO = '1';
    process.env.ADMIN_EMAILS = DEMO_STUDENTS[0].email;
    try {
      const demoUser = { ...user, email: DEMO_STUDENTS[0].email };
      expect(isInstructor(demoUser.email)).toBe(false);
      (requireScope as jest.Mock).mockResolvedValue({
        scope, user: demoUser, selected, admin: false, deploymentInstructor: false,
      });
      expect((await invoke({ message: 'Demo question' }))._getStatusCode()).toBe(200);
      expect(appendEvent).toHaveBeenCalledTimes(1);
    } finally {
      if (previousMode === undefined) delete process.env.CHECKHEN_MODE;
      else process.env.CHECKHEN_MODE = previousMode;
      if (previousDemo === undefined) delete process.env.CHECKHEN_DEMO;
      else process.env.CHECKHEN_DEMO = previousDemo;
      if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previousAdmins;
    }
  });
  it('rejects wrong methods', async () =>
    expect((await invoke({}, checkedIn(), 'GET'))._getStatusCode()).toBe(405));
  it('returns 401 without a session', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(401).json({ message: 'Unauthorized' }); return null; });
    expect((await invoke({ message: 'hello' }))._getStatusCode()).toBe(401);
  });
  it('rejects a student without an active check-in', async () => {
    expect((await invoke({ message: 'hello' }, { ...checkedIn(), attendance: [] }))._getStatusCode()).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it.each([{}, { message: '' }, { message: '   ' }, { message: 'x'.repeat(1001) }])(
    'rejects invalid messages',
    async (body) => {
      expect((await invoke(body))._getStatusCode()).toBe(400);
      expect(appendEvent).not.toHaveBeenCalled();
    }
  );
  it('rejects an ended session without recording a chat event', async () => {
    expect(
      (await invoke({ message: 'hello' }, { ...checkedIn(), endedAt: new Date() }))._getStatusCode()
    ).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('writes a chat event and accepts 1000 characters', async () => {
    const message = 'x'.repeat(1000);
    const res = await invoke({ message });
    expect(res._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        ...scope,
        kind: 'CHAT_MESSAGE',
        payload: { message, anonymousName: 'Swift Panda' },
      })
    );
    expect(JSON.parse(res._getJSONData().message)).toMatchObject({ message, anonymousName: 'Swift Panda' });
    expect(JSON.parse(res._getJSONData().message)).not.toHaveProperty('userId');
  });
});
