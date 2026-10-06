/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createMocks } from 'node-mocks-http';
import { appendEvent, readEvents, readState } from '@/lib/event-store';
import { examAgent } from '@/lib/exam-control';
import {
  bindDevice,
  revokeCurrentDevice,
  revokeSessionDevices,
  revokeStudentDevices,
} from '@/lib/portal-binding';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import { expireSessions } from '@/lib/session-expiry';
import coldCallRoute from '@/pages/api/admin/cold-call';
import examRoute from '@/pages/api/admin/exam';
import fetchAllChat from '@/pages/api/admin/fetch-all-chat';
import hideChat from '@/pages/api/admin/hide-chat';
import muteStudent from '@/pages/api/admin/mute-student';
import unhideChat from '@/pages/api/admin/unhide-chat';
import checkIn from '@/pages/api/student/check-in';
import checkOut from '@/pages/api/student/check-out';
import reBind from '@/pages/api/student/re-bind';
import sendChat from '@/pages/api/student/send-chat';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/portal-binding', () => ({
  bindDevice: jest.fn(),
  revokeDevice: jest.fn(),
  revokeCurrentDevice: jest.fn(),
  revokeStudentDevices: jest.fn(),
  revokeSessionDevices: jest.fn(),
}));
jest.mock('@/lib/exam-control', () => ({
  examDomains: jest.requireActual('@/lib/exam-control').examDomains,
  examAgent: jest.fn(),
}));

const integration = process.env.CHECKHEN_INTEGRATION === '1' ? describe : describe.skip;
integration('route → store → attendance fold', () => {
  let user: { id: string; email: string };
  let selected: { id: string; courseId: string; name: string; createdAt: Date; duration: number };
  let scope: { courseId: string; classId: string };
  const invoke = async (handler: typeof checkIn, ip: string) => {
    const { req, res } = createMocks({
      method: 'POST',
      query: scope,
      headers: { 'x-real-ip': ip },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
  };
  beforeEach(async () => {
    const suffix = randomUUID();
    user = await prisma.user.create({ data: { email: `attendance-${suffix}@example.edu` } });
    const course = await prisma.course.create({ data: { name: `Attendance ${suffix}` } });
    await prisma.rosterEntry.create({ data: { courseId: course.id, userId: user.id } });
    selected = await prisma.class.create({
      data: { courseId: course.id, name: 'Class', duration: 60 },
    });
    scope = { courseId: course.id, classId: selected.id };
    (requireScope as jest.Mock).mockResolvedValue({ user, selected, scope, admin: false });
    (bindDevice as jest.Mock).mockImplementation(async (req) => ({
      ip: req.headers['x-real-ip'],
      mac: req.headers['x-real-ip'] === '172.16.77.21' ? '02:00:00:00:00:21' : '02:00:00:00:00:20',
    }));
    (revokeCurrentDevice as jest.Mock).mockResolvedValue(undefined);
    (revokeStudentDevices as jest.Mock).mockResolvedValue(undefined);
    (revokeSessionDevices as jest.Mock).mockResolvedValue(undefined);
    (examAgent as jest.Mock).mockResolvedValue({
      active: true,
      clients: [{ userId: user.id, connected: false, disconnectedAt: 100, failed: true }],
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('tracks two devices, a primary IP change, and checkout from each', async () => {
    await invoke(checkIn, '172.16.77.20');
    await invoke(checkIn, '172.16.77.21');
    await invoke(checkIn, '172.16.77.22');
    let state = await readState(prisma, scope);
    expect(state.attendance[0].devices.map((device) => device.ip)).toEqual([
      '172.16.77.20',
      '172.16.77.21',
      '172.16.77.22',
    ]);
    await invoke(checkOut, '172.16.77.21');
    state = await readState(prisma, scope);
    expect(state.attendance[0].isPresent).toBe(true);
    expect(state.attendance[0].devices.map((device) => device.ip)).toEqual([
      '172.16.77.20',
      '172.16.77.22',
    ]);
    await invoke(checkOut, '172.16.77.22');
    state = await readState(prisma, scope);
    expect(state.attendance[0].isPresent).toBe(false);
    expect((await readEvents(prisma, scope)).map((event) => event.kind)).toEqual([
      'CHECK_IN',
      'DEVICE_BOUND',
      'DEVICE_BOUND',
      'DEVICE_UNBOUND',
      'CHECK_OUT',
    ]);
    expect(revokeStudentDevices).toHaveBeenCalledWith(scope, user);
  });

  it('serializes simultaneous check-ins from one student', async () => {
    await Promise.all([invoke(checkIn, '172.16.77.20'), invoke(checkIn, '172.16.77.21')]);
    const events = await readEvents(prisma, scope);
    expect(events.filter((event) => event.kind === 'CHECK_IN')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'DEVICE_BOUND')).toHaveLength(1);
    expect((await readState(prisma, scope)).attendance[0].devices).toHaveLength(2);
  });

  it('does not recreate attendance after checkout when another page heartbeats', async () => {
    await invoke(checkIn, '172.16.77.20');
    await invoke(checkOut, '172.16.77.20');
    const { req, res } = createMocks({
      method: 'POST',
      query: scope,
      headers: { 'x-real-ip': '172.16.77.20' },
    });
    await reBind(req as any, res as any);
    expect(res._getStatusCode()).toBe(409);
    expect((await readEvents(prisma, scope)).map((event) => event.kind)).toEqual([
      'CHECK_IN',
      'CHECK_OUT',
    ]);
    expect((await readState(prisma, scope)).attendance[0].isPresent).toBe(false);
  });

  it('records checkout and session end when duration lapses', async () => {
    await invoke(checkIn, '172.16.77.20');
    await prisma.class.update({
      where: { id: selected.id },
      data: {
        createdAt: new Date(Date.now() - 120000),
        duration: 1,
      },
    });
    expect(await expireSessions()).toBeGreaterThanOrEqual(1);
    expect(await expireSessions()).toBe(0);
    expect((await readEvents(prisma, scope)).map((event) => event.kind)).toEqual([
      'CHECK_IN',
      'CHECK_OUT',
      'SESSION_ENDED',
    ]);
    expect((await readState(prisma, scope)).attendance[0].isPresent).toBe(false);
    expect(revokeSessionDevices).toHaveBeenCalledWith(scope);
  });

  it('closes exam policy and records exam end before automatic session expiry', async () => {
    await invoke(checkIn, '172.16.77.20');
    const examId = randomUUID();
    await appendEvent(prisma, {
      ...scope,
      actorId: 'instructor',
      kind: 'EXAM_STARTED',
      payload: { examId, domains: ['exam.example.edu'], thresholdSeconds: 30 },
    });
    await prisma.class.update({
      where: { id: selected.id },
      data: {
        createdAt: new Date(Date.now() - 120000),
        duration: 1,
      },
    });
    expect(await expireSessions()).toBeGreaterThanOrEqual(1);
    expect(examAgent).toHaveBeenCalledWith('exam-stop', scope);
    expect((await readEvents(prisma, scope)).map((event) => event.kind)).toEqual([
      'CHECK_IN',
      'EXAM_STARTED',
      'CHECK_OUT',
      'EXAM_ENDED',
      'SESSION_ENDED',
    ]);
  });

  it('preserves CHECK_IN corrections for a present student', async () => {
    await invoke(checkIn, '172.16.77.20');
    const original = (await readEvents(prisma, scope))[0];
    const correction = await appendEvent(prisma, {
      ...scope,
      actorId: user.id,
      userId: user.id,
      kind: 'CHECK_IN',
      payload: { anonymousName: 'Corrected Otter' },
      supersedesId: original.id,
    });
    expect(correction.kind).toBe('CHECK_IN');
    expect(correction.supersedesId).toBe(original.id);
    expect((await readState(prisma, scope)).attendance[0].anonymousName).toBe('Corrected Otter');
  });

  it('keeps an automatic exam fail after the instructor excuses it', async () => {
    await invoke(checkIn, '172.16.77.20');
    const examId = randomUUID();
    await appendEvent(prisma, {
      ...scope,
      actorId: 'instructor',
      kind: 'EXAM_STARTED',
      payload: { examId, domains: ['exam.example.edu'], thresholdSeconds: 30 },
    });
    const fail = await appendEvent(prisma, {
      ...scope,
      actorId: 'system:exam-monitor',
      userId: user.id,
      kind: 'EXAM_FAILED',
      payload: { examId },
    });
    (requireScope as jest.Mock).mockResolvedValue({
      user: { id: 'instructor' },
      selected,
      scope,
      admin: true,
    });
    const { req, res } = createMocks({
      method: 'POST',
      query: scope,
      body: { action: 'excuse', failId: fail.id, reason: 'Verified AP outage' },
    });
    await examRoute(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    const events = await readEvents(prisma, scope);
    expect(events.find((event) => event.id === fail.id)?.kind).toBe('EXAM_FAILED');
    expect(events.find((event) => event.kind === 'EXAM_EXCUSED')?.supersedesId).toBe(fail.id);
    const { req: statusReq, res: statusRes } = createMocks({ method: 'GET', query: scope });
    await examRoute(statusReq as any, statusRes as any);
    expect(statusRes._getJSONData().fails[0]).toMatchObject({
      id: fail.id,
      excused: true,
      reason: 'Verified AP outage',
    });
  });

  describe('cold calling', () => {
    const call = async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
      const { req, res } = createMocks({ method, query: scope, body });
      await coldCallRoute(req as any, res as any);
      return res;
    };
    const draw = async () => {
      const res = await call('POST', { action: 'draw' });
      expect(res._getStatusCode()).toBe(200);
      return res._getJSONData();
    };
    const record = (token: string, outcome = 'answered') =>
      call('POST', { action: 'record', outcome, draw: token });
    const statuses = (responses: { _getStatusCode(): number }[]) =>
      responses.map((res) => res._getStatusCode()).sort();
    /** A rostered, checked-in student created directly in the log. */
    const student = async (name: string) => {
      const created = await prisma.user.create({
        data: { email: `${name}-${randomUUID()}@example.edu`, displayName: name },
      });
      await prisma.rosterEntry.create({ data: { courseId: scope.courseId, userId: created.id } });
      await appendEvent(prisma, {
        ...scope,
        actorId: created.id,
        userId: created.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: `Anon ${name}` },
      });
      return created;
    };
    beforeEach(() => {
      process.env.AUTH_SECRET = 'checkhen-test-draw-secret';
      (requireScope as jest.Mock).mockResolvedValue({
        user: { id: 'instructor' },
        selected,
        scope,
        admin: true,
      });
    });

    it('draws, records, and undoes a cold call through the event log', async () => {
      await appendEvent(prisma, {
        ...scope,
        actorId: user.id,
        userId: user.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: 'Anon Alisha' },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { displayName: 'Alisha', namePronunciation: 'ale-EE-sha' },
      });
      const drawn = await draw();
      expect(drawn.student).toMatchObject({
        userId: user.id,
        name: 'Alisha',
        pronunciation: 'ale-EE-sha',
      });
      const recorded = await record(drawn.draw);
      expect(recorded._getStatusCode()).toBe(200);
      // Called today with no retry outstanding: no one is left to call.
      expect((await call('POST', { action: 'draw' }))._getStatusCode()).toBe(409);
      const callId = recorded._getJSONData().id;
      expect((await call('POST', { action: 'undo', eventId: callId }))._getStatusCode()).toBe(200);
      expect((await call('GET'))._getJSONData().calls).toEqual([]);
      await draw();
      const events = await readEvents(prisma, scope);
      expect(events.find((event) => event.id === callId)).toMatchObject({
        kind: 'COLD_CALL',
        userId: user.id,
        payload: { outcome: 'answered', seed: drawn.seed },
      });
      expect(events.find((event) => event.kind === 'UNDO')?.supersedesId).toBe(callId);
    });

    it('refuses a draw with no one checked in and always draws a lone student', async () => {
      expect((await call('POST', { action: 'draw' }))._getStatusCode()).toBe(409);
      const only = await student('Only');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await draw()).student.userId).toBe(only.id);
      }
    });

    it('refuses forged and duplicate records', async () => {
      await student('Ada');
      const { draw: token } = await draw();
      const [body] = token.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(body, 'base64url').toString()),
          userId: user.id,
        })
      ).toString('base64url');
      expect((await record(forged + '.' + token.split('.')[1]))._getStatusCode()).toBe(400);
      expect((await call('POST', { action: 'record', outcome: 'answered' }))._getStatusCode()).toBe(
        400
      );
      // A double tap on one draw records once.
      expect(statuses(await Promise.all([record(token), record(token, 'pass')]))).toEqual([
        200, 409,
      ]);
      expect((await call('GET'))._getJSONData().calls).toHaveLength(1);
    });

    it('lets only one of two phones record the same student', async () => {
      await student('Grace');
      const first = await draw();
      const second = await draw();
      expect(second.student.userId).toBe(first.student.userId);
      expect(statuses(await Promise.all([record(first.draw), record(second.draw)]))).toEqual([
        200, 409,
      ]);
    });

    it('refuses a stale draw for a student who is no longer eligible', async () => {
      const leaving = await student('Lin');
      const stale = await draw();
      await appendEvent(prisma, {
        ...scope,
        actorId: leaving.id,
        userId: leaving.id,
        kind: 'CHECK_OUT',
      });
      const res = await record(stale.draw);
      expect(res._getStatusCode()).toBe(409);
      expect(res._getJSONData().message).toBe('This student can no longer be called');
    });

    it('undoes a call once when two phones undo it together', async () => {
      await student('Mae');
      const recorded = await record((await draw()).draw);
      const eventId = recorded._getJSONData().id;
      expect(
        statuses(
          await Promise.all([
            call('POST', { action: 'undo', eventId }),
            call('POST', { action: 'undo', eventId }),
          ])
        )
      ).toEqual([200, 409]);
      const undos = (await readEvents(prisma, scope)).filter((event) => event.kind === 'UNDO');
      expect(undos).toHaveLength(1);
    });
  });

  it('hides a stored message and mutes its student without deleting facts', async () => {
    await invoke(checkIn, '172.16.77.20');
    const request = async (handler: typeof checkIn, body: Record<string, unknown>) => {
      const { req, res } = createMocks({ method: 'POST', query: scope, body });
      await handler(req as any, res as any);
      return res;
    };
    expect((await request(sendChat, { message: 'Question?' }))._getStatusCode()).toBe(200);
    const message = (await readEvents(prisma, scope)).find(
      (event) => event.kind === 'CHAT_MESSAGE'
    )!;
    expect((await request(hideChat, { messageId: message.id }))._getStatusCode()).toBe(200);
    expect((await readState(prisma, scope)).messages).toEqual([]);
    const hide = (await readEvents(prisma, scope)).find((event) => event.kind === 'CHAT_HIDDEN')!;
    expect(hide.supersedesId).toBe(message.id);
    expect((await readEvents(prisma, scope)).some((event) => event.id === message.id)).toBe(true);
    expect((await readState(prisma, scope)).instructorMessages[0]).toMatchObject({
      id: message.id,
      hidden: true,
      hideEventId: hide.id,
    });
    const { req: adminReq, res: adminRes } = createMocks({ method: 'GET', query: scope });
    await fetchAllChat(adminReq as any, adminRes as any);
    expect(JSON.parse(adminRes._getJSONData().message)[0]).toMatchObject({
      id: message.id,
      hidden: true,
      hideEventId: hide.id,
      userId: user.id,
    });
    expect((await request(unhideChat, { messageId: message.id }))._getStatusCode()).toBe(200);
    expect((await readState(prisma, scope)).messages[0].id).toBe(message.id);
    expect((await readState(prisma, scope)).instructorMessages[0].hidden).toBe(false);
    expect((await readEvents(prisma, scope)).at(-1)).toMatchObject({
      kind: 'UNDO',
      supersedesId: hide.id,
    });
    expect((await request(muteStudent, { userId: user.id }))._getStatusCode()).toBe(200);
    expect((await request(sendChat, { message: 'Again?' }))._getStatusCode()).toBe(403);
    expect((await readState(prisma, scope)).mutedUsers).toEqual([user.id]);
  });

  it('continues past a failed expiry, skips legacy and empty classes, and stamps the lapse', async () => {
    const base = Date.now() - 10 * 60000;
    const createClass = (name: string, createdAt: Date) =>
      prisma.class.create({
        data: {
          courseId: scope.courseId,
          name,
          duration: 1,
          createdAt,
        },
      });
    const failing = await createClass('Failing', new Date(base));
    const succeeding = await createClass('Succeeding', new Date(base + 1000));
    const legacy = await createClass('Legacy', new Date(Date.now() - 30 * 86400000));
    const empty = await createClass('Empty', new Date(base + 2000));
    for (const cls of [failing, succeeding, legacy]) {
      await prisma.participationEvent.create({
        data: {
          id: randomUUID(),
          courseId: scope.courseId,
          classId: cls.id,
          userId: user.id,
          actorId: user.id,
          kind: 'CHECK_IN',
          payload: { anonymousName: 'Swift Panda' },
          createdAt: new Date(cls.createdAt.getTime() + 1000),
        },
      });
    }
    (revokeSessionDevices as jest.Mock).mockImplementation(async (selectedScope) => {
      if (selectedScope.classId === failing.id) {
        throw new Error('Agent unavailable for this class');
      }
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expireSessions(new Date());
    } finally {
      log.mockRestore();
    }
    const successEvents = await readEvents(prisma, {
      courseId: scope.courseId,
      classId: succeeding.id,
    });
    expect(successEvents.map((event) => event.kind)).toEqual([
      'CHECK_IN',
      'CHECK_OUT',
      'SESSION_ENDED',
    ]);
    expect(successEvents[1].createdAt.getTime()).toBe(succeeding.createdAt.getTime() + 60000);
    for (const cls of [failing, legacy, empty]) {
      expect(
        (await readEvents(prisma, { courseId: scope.courseId, classId: cls.id })).some(
          (event) => event.kind === 'SESSION_ENDED'
        )
      ).toBe(false);
    }
  });
});
