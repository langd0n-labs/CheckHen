/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createMocks } from 'node-mocks-http';
import { prisma } from '@/lib/prisma';
import { appendEvent, readEvents, readState } from '@/lib/event-store';
import { requireScope } from '@/lib/request-scope';
import { bindDevice, revokeCurrentDevice, revokeStudentDevices } from '@/lib/portal-binding';
import { revokeSessionDevices } from '@/lib/portal-binding';
import { expireSessions } from '@/lib/session-expiry';
import checkIn from '@/pages/api/student/check-in';
import reBind from '@/pages/api/student/re-bind';
import checkOut from '@/pages/api/student/check-out';
import sendChat from '@/pages/api/student/send-chat';
import hideChat from '@/pages/api/admin/hide-chat';
import muteStudent from '@/pages/api/admin/mute-student';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/portal-binding', () => ({
  bindDevice: jest.fn(), revokeDevice: jest.fn(), revokeCurrentDevice: jest.fn(),
  revokeStudentDevices: jest.fn(), revokeSessionDevices: jest.fn(),
}));

const integration = process.env.CHECKHEN_INTEGRATION === '1' ? describe : describe.skip;
integration('route → store → attendance fold', () => {
  let user: { id: string; email: string };
  let selected: { id: string; courseId: string; name: string; createdAt: Date; duration: number };
  let scope: { courseId: string; classId: string };
  const invoke = async (handler: typeof checkIn, ip: string) => {
    const { req, res } = createMocks({ method: 'POST', query: scope, headers: { 'x-real-ip': ip } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
  };
  beforeEach(async () => {
    const suffix = randomUUID();
    user = await prisma.user.create({ data: { email: `attendance-${suffix}@example.edu` } });
    const course = await prisma.course.create({ data: { name: `Attendance ${suffix}` } });
    await prisma.rosterEntry.create({ data: { courseId: course.id, userId: user.id } });
    selected = await prisma.class.create({ data: { courseId: course.id, name: 'Class', duration: 60 } });
    scope = { courseId: course.id, classId: selected.id };
    (requireScope as jest.Mock).mockResolvedValue({ user, selected, scope, admin: false });
    (bindDevice as jest.Mock).mockImplementation(async req => ({ ip: req.headers['x-real-ip'],
      mac: req.headers['x-real-ip'] === '172.16.77.21' ? '02:00:00:00:00:21' : '02:00:00:00:00:20' }));
    (revokeCurrentDevice as jest.Mock).mockResolvedValue(undefined);
    (revokeStudentDevices as jest.Mock).mockResolvedValue(undefined);
    (revokeSessionDevices as jest.Mock).mockResolvedValue(undefined);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('tracks two devices, a primary IP change, and checkout from each', async () => {
    await invoke(checkIn, '172.16.77.20');
    await invoke(checkIn, '172.16.77.21');
    await invoke(checkIn, '172.16.77.22');
    let state = await readState(prisma, scope);
    expect(state.attendance[0].devices.map(device => device.ip)).toEqual([
      '172.16.77.20', '172.16.77.21', '172.16.77.22',
    ]);
    await invoke(checkOut, '172.16.77.21');
    state = await readState(prisma, scope);
    expect(state.attendance[0].isPresent).toBe(true);
    expect(state.attendance[0].devices.map(device => device.ip)).toEqual([
      '172.16.77.20', '172.16.77.22',
    ]);
    await invoke(checkOut, '172.16.77.22');
    state = await readState(prisma, scope);
    expect(state.attendance[0].isPresent).toBe(false);
    expect((await readEvents(prisma, scope)).map(event => event.kind)).toEqual([
      'CHECK_IN', 'DEVICE_BOUND', 'DEVICE_BOUND', 'DEVICE_UNBOUND', 'CHECK_OUT',
    ]);
    expect(revokeStudentDevices).toHaveBeenCalledWith(scope, user);
  });

  it('serializes simultaneous check-ins from one student', async () => {
    await Promise.all([invoke(checkIn, '172.16.77.20'), invoke(checkIn, '172.16.77.21')]);
    const events = await readEvents(prisma, scope);
    expect(events.filter(event => event.kind === 'CHECK_IN')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'DEVICE_BOUND')).toHaveLength(1);
    expect((await readState(prisma, scope)).attendance[0].devices).toHaveLength(2);
  });

  it('does not recreate attendance after checkout when another page heartbeats', async () => {
    await invoke(checkIn, '172.16.77.20');
    await invoke(checkOut, '172.16.77.20');
    const { req, res } = createMocks({ method: 'POST', query: scope,
      headers: { 'x-real-ip': '172.16.77.20' } });
    await reBind(req as any, res as any);
    expect(res._getStatusCode()).toBe(409);
    expect((await readEvents(prisma, scope)).map(event => event.kind)).toEqual(['CHECK_IN', 'CHECK_OUT']);
    expect((await readState(prisma, scope)).attendance[0].isPresent).toBe(false);
  });

  it('records checkout and session end when duration lapses', async () => {
    await invoke(checkIn, '172.16.77.20');
    await prisma.class.update({ where: { id: selected.id }, data: {
      createdAt: new Date(Date.now() - 120000), duration: 1,
    } });
    expect(await expireSessions()).toBeGreaterThanOrEqual(1);
    expect(await expireSessions()).toBe(0);
    expect((await readEvents(prisma, scope)).map(event => event.kind)).toEqual([
      'CHECK_IN', 'CHECK_OUT', 'SESSION_ENDED',
    ]);
    expect((await readState(prisma, scope)).attendance[0].isPresent).toBe(false);
    expect(revokeSessionDevices).toHaveBeenCalledWith(scope);
  });

  it('preserves CHECK_IN corrections for a present student', async () => {
    await invoke(checkIn, '172.16.77.20');
    const original = (await readEvents(prisma, scope))[0];
    const correction = await appendEvent(prisma, { ...scope, actorId: user.id, userId: user.id,
      kind: 'CHECK_IN', payload: { anonymousName: 'Corrected Otter' }, supersedesId: original.id });
    expect(correction.kind).toBe('CHECK_IN');
    expect(correction.supersedesId).toBe(original.id);
    expect((await readState(prisma, scope)).attendance[0].anonymousName).toBe('Corrected Otter');
  });

  it('hides a stored message and mutes its student without deleting facts', async () => {
    await invoke(checkIn, '172.16.77.20');
    const request = async (handler: typeof checkIn, body: Record<string, unknown>) => {
      const { req, res } = createMocks({ method: 'POST', query: scope, body });
      await handler(req as any, res as any);
      return res;
    };
    expect((await request(sendChat, { message: 'Question?' }))._getStatusCode()).toBe(200);
    const message = (await readEvents(prisma, scope)).find(event => event.kind === 'CHAT_MESSAGE')!;
    expect((await request(hideChat, { messageId: message.id }))._getStatusCode()).toBe(200);
    expect((await readState(prisma, scope)).messages).toEqual([]);
    const hide = (await readEvents(prisma, scope)).find(event => event.kind === 'CHAT_HIDDEN')!;
    expect(hide.supersedesId).toBe(message.id);
    expect((await readEvents(prisma, scope)).some(event => event.id === message.id)).toBe(true);
    expect((await request(muteStudent, { userId: user.id }))._getStatusCode()).toBe(200);
    expect((await request(sendChat, { message: 'Again?' }))._getStatusCode()).toBe(403);
    expect((await readState(prisma, scope)).mutedUsers).toEqual([user.id]);
  });

  it('continues past a failed expiry, skips legacy and empty classes, and stamps the lapse', async () => {
    const base = Date.now() - 10 * 60000;
    const createClass = (name: string, createdAt: Date) => prisma.class.create({ data: {
      courseId: scope.courseId, name, duration: 1, createdAt,
    } });
    const failing = await createClass('Failing', new Date(base));
    const succeeding = await createClass('Succeeding', new Date(base + 1000));
    const legacy = await createClass('Legacy', new Date(Date.now() - 30 * 86400000));
    const empty = await createClass('Empty', new Date(base + 2000));
    for (const cls of [failing, succeeding, legacy]) {
      await prisma.participationEvent.create({ data: {
        id: randomUUID(), courseId: scope.courseId, classId: cls.id, userId: user.id,
        actorId: user.id, kind: 'CHECK_IN', payload: { anonymousName: 'Swift Panda' },
        createdAt: new Date(cls.createdAt.getTime() + 1000),
      } });
    }
    (revokeSessionDevices as jest.Mock).mockImplementation(async selectedScope => {
      if (selectedScope.classId === failing.id) throw new Error('Agent unavailable for this class');
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try { await expireSessions(new Date()); } finally { log.mockRestore(); }
    const successEvents = await readEvents(prisma, { courseId: scope.courseId, classId: succeeding.id });
    expect(successEvents.map(event => event.kind)).toEqual(['CHECK_IN', 'CHECK_OUT', 'SESSION_ENDED']);
    expect(successEvents[1].createdAt.getTime()).toBe(succeeding.createdAt.getTime() + 60000);
    for (const cls of [failing, legacy, empty]) {
      expect((await readEvents(prisma, { courseId: scope.courseId, classId: cls.id }))
        .some(event => event.kind === 'SESSION_ENDED')).toBe(false);
    }
  });
});
