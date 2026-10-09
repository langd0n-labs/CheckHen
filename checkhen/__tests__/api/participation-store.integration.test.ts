/** @jest-environment node */
import { createHmac, randomUUID } from 'node:crypto';
import { createMocks } from 'node-mocks-http';
import { appendEvent, readEvents, readState } from '@/lib/event-store';
import { examAgent, recordExamFail, releaseExamNetwork } from '@/lib/exam-control';
import {
  bindDevice,
  revokeCurrentDevice,
  revokeSessionDevices,
  revokeStudentDevices,
} from '@/lib/portal-binding';
import { prisma } from '@/lib/prisma';
import { requireIdentity, requireScope } from '@/lib/request-scope';
import { expireSessions } from '@/lib/session-expiry';
import coldCallRoute from '@/pages/api/admin/cold-call';
import courseReportRoute from '@/pages/api/admin/course-report';
import examRoute from '@/pages/api/admin/exam';
import fetchAllChat from '@/pages/api/admin/fetch-all-chat';
import hideChat from '@/pages/api/admin/hide-chat';
import muteStudent from '@/pages/api/admin/mute-student';
import unhideChat from '@/pages/api/admin/unhide-chat';
import checkIn from '@/pages/api/student/check-in';
import checkOut from '@/pages/api/student/check-out';
import reBind from '@/pages/api/student/re-bind';
import sendChat from '@/pages/api/student/send-chat';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn(), requireIdentity: jest.fn() }));
jest.mock('@/lib/portal-binding', () => ({
  bindDevice: jest.fn(),
  revokeDevice: jest.fn(),
  revokeCurrentDevice: jest.fn(),
  revokeStudentDevices: jest.fn(),
  revokeSessionDevices: jest.fn(),
}));
jest.mock('@/lib/exam-control', () => ({
  recordExamFail: jest.requireActual('@/lib/exam-control').recordExamFail,
  examDomains: jest.requireActual('@/lib/exam-control').examDomains,
  examAgent: jest.fn(),
  releaseExamNetwork: jest.fn().mockResolvedValue(undefined),
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
    expect(releaseExamNetwork).toHaveBeenCalledWith(scope);
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
      // Being called does not take a student off the hook for the rest of the meeting.
      expect((await draw()).student.userId).toBe(user.id);
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
      // A double tap on one draw records once; the second tap fails on the used draw.
      const taps = await Promise.all([record(token), record(token, 'pass')]);
      expect(statuses(taps)).toEqual([200, 409]);
      expect(taps.find((res: any) => res._getStatusCode() === 409)!._getJSONData().message).toBe(
        'This call is already recorded'
      );
      expect((await call('GET'))._getJSONData().calls).toHaveLength(1);
    });

    it("refuses the older of two phones' draws of the same student", async () => {
      await student('Grace');
      const first = await draw();
      const second = await draw();
      expect(second.student.userId).toBe(first.student.userId);
      const both = await Promise.all([record(first.draw), record(second.draw)]);
      expect(statuses(both)).toEqual([200, 409]);
      // The second draw replaced the first, so the first phone is the one refused.
      expect(both[0]._getJSONData().message).toBe('A newer draw replaced this one');
    });

    it('refuses a draw token from a session with no recorded draws', async () => {
      const ada = await student('Ada');
      const res = await record(
        signed({ ...scope, kind: 'draw', userId: ada.id, seed: 7, issuedAt: Date.now() })
      );
      expect(res._getStatusCode()).toBe(409);
      expect(res._getJSONData().message).toBe(
        'This draw is no longer valid. Call on someone again.'
      );
    });

    it('orders a draw and a record that run at the same time', async () => {
      await student('Ada');
      await student('Ben');
      const pending = await draw();
      const [recorded] = await Promise.all([
        record(pending.draw),
        call('POST', { action: 'draw' }),
      ]);
      const events = await readEvents(prisma, scope);
      const draws = events.filter((event) => event.kind === 'COLD_CALL_DRAWN');
      const calls = events.filter((event) => event.kind === 'COLD_CALL');
      if (recorded._getStatusCode() === 200) {
        // The record won the lock: it follows its own draw and precedes the new one.
        expect(calls).toHaveLength(1);
        expect(calls[0].createdAt.getTime()).toBeLessThan(draws.at(-1)!.createdAt.getTime());
      } else {
        expect(recorded._getJSONData().message).toBe('A newer draw replaced this one');
        expect(calls).toHaveLength(0);
      }
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

    /** A token signed like the route's, for binding and expiry checks. */
    const signed = (fields: Record<string, unknown>) => {
      const body = Buffer.from(JSON.stringify(fields)).toString('base64url');
      return (
        body + '.' + createHmac('sha256', process.env.AUTH_SECRET!).update(body).digest('base64url')
      );
    };

    it('refuses an earlier draw after a newer one', async () => {
      await student('Ada');
      await student('Ben');
      const earlier = await draw();
      const newer = await draw();
      const res = await record(earlier.draw);
      expect(res._getStatusCode()).toBe(409);
      expect(res._getJSONData().message).toBe('A newer draw replaced this one');
      expect((await record(newer.draw))._getStatusCode()).toBe(200);
    });

    it('refuses an expired token and a token for another session', async () => {
      const ada = await student('Ada');
      const { seed } = await draw();
      const expired = signed({
        ...scope,
        kind: 'draw',
        userId: ada.id,
        seed,
        issuedAt: Date.now() - 31 * 60 * 1000,
      });
      expect((await record(expired))._getStatusCode()).toBe(400);
      const other = await prisma.class.create({
        data: { courseId: scope.courseId, name: 'Other', duration: 60 },
      });
      const elsewhere = signed({
        courseId: scope.courseId,
        classId: other.id,
        kind: 'draw',
        userId: ada.id,
        seed,
        issuedAt: Date.now(),
      });
      expect((await record(elsewhere))._getStatusCode()).toBe(400);
      // The genuine token for this session's latest draw still records.
      expect(
        (
          await record(
            signed({ ...scope, kind: 'draw', userId: ada.id, seed, issuedAt: Date.now() })
          )
        )._getStatusCode()
      ).toBe(200);
    });

    it('makes a student callable again after an Absent call is undone', async () => {
      const late = await student('Lee');
      const absent = await record((await draw()).draw, 'absent');
      expect(absent._getStatusCode()).toBe(200);
      // Absent means the student left: they are checked out and cannot be drawn.
      const present = async () =>
        (await readState(prisma, scope)).attendance.find((entry) => entry.userId === late.id)
          ?.isPresent;
      expect(await present()).toBe(false);
      expect((await call('POST', { action: 'draw' }))._getStatusCode()).toBe(409);
      const eventId = absent._getJSONData().id;
      expect((await call('POST', { action: 'undo', eventId }))._getStatusCode()).toBe(200);
      // Undoing a mistaken Absent also undoes its check-out.
      expect(await present()).toBe(true);
      expect((await draw()).student.userId).toBe(late.id);
    });

    it('keeps the call list and follow-ups working after undos of other event kinds', async () => {
      const keen = await student('Noa');
      // Undo an Absent: its linked CHECK_OUT gets an UNDO the call list does not show.
      const absent = await record((await draw()).draw, 'absent');
      await call('POST', { action: 'undo', eventId: absent._getJSONData().id });
      // Unhide a chat message: an UNDO aimed at a CHAT_HIDDEN event.
      const message = await appendEvent(prisma, {
        ...scope,
        actorId: keen.id,
        userId: keen.id,
        kind: 'CHAT_MESSAGE',
        payload: { message: 'hello', anonymousName: 'Anon Noa' },
      });
      const hidden = await appendEvent(prisma, {
        ...scope,
        actorId: 'instructor',
        userId: keen.id,
        kind: 'CHAT_HIDDEN',
        payload: { messageId: message.id },
        supersedesId: message.id,
      });
      await appendEvent(prisma, {
        ...scope,
        actorId: 'instructor',
        userId: keen.id,
        kind: 'UNDO',
        supersedesId: hidden.id,
      });
      const status = await call('GET');
      expect(status._getStatusCode()).toBe(200);
      expect(status._getJSONData().calls).toEqual([]);
      const first = await call('POST', {
        action: 'record',
        outcome: 'answered',
        draw: (await draw()).draw,
        next: 'follow-up',
      });
      expect(first._getStatusCode()).toBe(200);
      const followUp = await call('POST', {
        action: 'record',
        outcome: 'answered',
        followUp: first._getJSONData().followUp,
      });
      expect(followUp._getStatusCode()).toBe(200);
      expect((await call('GET'))._getJSONData().calls).toHaveLength(2);
    });

    it('writes nothing when a follow-on event fails', async () => {
      const ada = await student('Ada');
      const before = (await readEvents(prisma, scope)).length;
      await expect(
        appendEvent(prisma, {
          ...scope,
          actorId: 'instructor',
          userId: ada.id,
          kind: 'COLD_CALL',
          payload: { outcome: 'absent' },
          // An undo of an event that does not exist fails inside the transaction.
          alsoWrite: async () => [
            {
              ...scope,
              actorId: 'instructor',
              userId: ada.id,
              kind: 'UNDO',
              supersedesId: 'missing',
            },
          ],
        })
      ).rejects.toThrow('Unknown superseded event');
      expect(await readEvents(prisma, scope)).toHaveLength(before);
    });

    it('writes an Absent and its check-out, and undoes both, as single steps', async () => {
      const lee = await student('Lee');
      const absent = await record((await draw()).draw, 'absent');
      const callId = absent._getJSONData().id;
      const afterRecord = await readEvents(prisma, scope);
      const checkOut = afterRecord.find(
        (event) => event.kind === 'CHECK_OUT' && event.payload.coldCallId === callId
      );
      expect(checkOut).toMatchObject({ userId: lee.id });
      expect((await call('POST', { action: 'undo', eventId: callId }))._getStatusCode()).toBe(200);
      const undos = (await readEvents(prisma, scope)).filter((event) => event.kind === 'UNDO');
      expect(undos.map((event) => event.supersedesId).sort()).toEqual(
        [callId, checkOut!.id].sort()
      );
    });

    it('keeps follow-ups counted and labeled when the first call of the run is undone', async () => {
      const ari = await student('Ari');
      const first = await record((await draw()).draw);
      const { id: firstId, followUp } = first._getJSONData();
      const second = await call('POST', { action: 'record', outcome: 'answered', followUp });
      expect(second._getStatusCode()).toBe(200);
      expect((await call('POST', { action: 'undo', eventId: firstId }))._getStatusCode()).toBe(200);
      // The follow-up was a real question: it stays, marked as a follow-up.
      expect((await call('GET'))._getJSONData().calls).toEqual([
        expect.objectContaining({ userId: ari.id, outcome: 'answered', followUp: true }),
      ]);
      (requireIdentity as jest.Mock).mockResolvedValue({ user: { id: 'instructor' }, admin: true });
      const { req, res } = createMocks({ method: 'GET', query: { courseId: scope.courseId } });
      await courseReportRoute(req as any, res as any);
      expect(
        res._getJSONData().report.students.find((row: any) => row.userId === ari.id)
      ).toMatchObject({ answers: 1, opportunities: 1 });
    });

    it('records an Absent for a student who already checked out', async () => {
      const gone = await student('Ida');
      const drawn = await draw();
      await appendEvent(prisma, { ...scope, actorId: gone.id, userId: gone.id, kind: 'CHECK_OUT' });
      expect((await record(drawn.draw, 'absent'))._getStatusCode()).toBe(200);
      // No second check-out: the student was already out.
      const checkOuts = (await readEvents(prisma, scope)).filter(
        (event) => event.kind === 'CHECK_OUT' && event.userId === gone.id
      );
      expect(checkOuts).toHaveLength(1);
      // Other outcomes still need the student present.
      await appendEvent(prisma, {
        ...scope,
        actorId: gone.id,
        userId: gone.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: 'Anon Ida' },
      });
      const again = await draw();
      await appendEvent(prisma, { ...scope, actorId: gone.id, userId: gone.id, kind: 'CHECK_OUT' });
      expect((await record(again.draw, 'answered'))._getStatusCode()).toBe(409);
    });

    it('never records a follow-up after a draw that ran at the same time', async () => {
      await student('Bo');
      await student('Cy');
      const { followUp } = (await record((await draw()).draw))._getJSONData();
      const [followed] = await Promise.all([
        call('POST', { action: 'record', outcome: 'answered', followUp }),
        call('POST', { action: 'draw' }),
      ]);
      const events = await readEvents(prisma, scope);
      const lastDraw = events.filter((event) => event.kind === 'COLD_CALL_DRAWN').at(-1)!;
      const followUps = events.filter(
        (event) => event.kind === 'COLD_CALL' && event.payload.followUpOf
      );
      if (followed._getStatusCode() === 200) {
        // The follow-up won the lock: it precedes the new draw.
        expect(followUps).toHaveLength(1);
        expect(followUps[0].createdAt.getTime()).toBeLessThan(lastDraw.createdAt.getTime());
      } else {
        expect(followed._getStatusCode()).toBe(409);
        expect(followUps).toHaveLength(0);
      }
    });

    /** Make inserts that match `fails` throw inside the transaction, like a database error. */
    const failInsert = (fails: (data: any) => boolean) => {
      const original = prisma.$transaction.bind(prisma) as any;
      return jest.spyOn(prisma, '$transaction').mockImplementation(((fn: any, options?: any) =>
        typeof fn !== 'function'
          ? original(fn, options)
          : original(
              (tx: any) =>
                fn(
                  new Proxy(tx, {
                    get(target, prop) {
                      const value = target[prop];
                      if (prop !== 'participationEvent') {
                        return typeof value === 'function' ? value.bind(target) : value;
                      }
                      return new Proxy(value, {
                        get(model, key) {
                          const method = model[key];
                          if (key === 'create') {
                            return (args: any) =>
                              fails(args.data)
                                ? Promise.reject(new Error('Injected failure'))
                                : method.call(model, args);
                          }
                          return typeof method === 'function' ? method.bind(model) : method;
                        },
                      });
                    },
                  })
                ),
              options
            )) as any);
    };

    it('writes neither the Absent nor its check-out when the check-out fails', async () => {
      const lee = await student('Lee');
      const { draw: token } = await draw();
      const spy = failInsert((data) => data.kind === 'CHECK_OUT');
      await expect(record(token, 'absent')).rejects.toThrow('Injected failure');
      spy.mockRestore();
      expect(
        (await readEvents(prisma, scope)).filter((event) => event.kind === 'COLD_CALL')
      ).toHaveLength(0);
      const present = (await readState(prisma, scope)).attendance.find(
        (entry) => entry.userId === lee.id
      );
      expect(present?.isPresent).toBe(true);
      // The same tap succeeds once the failure clears, and writes both events.
      expect((await record(token, 'absent'))._getStatusCode()).toBe(200);
      const kinds = (await readEvents(prisma, scope)).map((event) => event.kind);
      expect(kinds.filter((kind) => kind === 'COLD_CALL' || kind === 'CHECK_OUT')).toEqual([
        'COLD_CALL',
        'CHECK_OUT',
      ]);
    });

    it('undoes neither the Absent nor its check-out when the second undo fails', async () => {
      await student('Mo');
      const callId = (await record((await draw()).draw, 'absent'))._getJSONData().id;
      const checkOut = (await readEvents(prisma, scope)).find(
        (event) => event.kind === 'CHECK_OUT' && event.payload.coldCallId === callId
      )!;
      const spy = failInsert((data) => data.kind === 'UNDO' && data.supersedesId === checkOut.id);
      await expect(call('POST', { action: 'undo', eventId: callId })).rejects.toThrow(
        'Injected failure'
      );
      spy.mockRestore();
      expect(
        (await readEvents(prisma, scope)).filter((event) => event.kind === 'UNDO')
      ).toHaveLength(0);
      expect((await call('POST', { action: 'undo', eventId: callId }))._getStatusCode()).toBe(200);
      expect(
        (await readEvents(prisma, scope)).filter((event) => event.kind === 'UNDO')
      ).toHaveLength(2);
    });

    it('refuses an Absent after the session ended or for an inactive student', async () => {
      const ended = await student('Ned');
      const first = await draw();
      await appendEvent(prisma, { ...scope, actorId: 'system', kind: 'SESSION_ENDED' });
      const afterEnd = await record(first.draw, 'absent');
      expect(afterEnd._getStatusCode()).toBe(409);
      expect(afterEnd._getJSONData().message).toBe('This class session has ended');
      // A fresh session for the inactive-student case.
      const next = await prisma.class.create({
        data: { courseId: scope.courseId, name: 'Next', duration: 60 },
      });
      const nextScope = { courseId: scope.courseId, classId: next.id };
      (requireScope as jest.Mock).mockResolvedValue({
        user: { id: 'instructor' },
        selected: next,
        scope: nextScope,
        admin: true,
      });
      await appendEvent(prisma, {
        ...nextScope,
        actorId: ended.id,
        userId: ended.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: 'Anon Ned' },
      });
      const nextCall = async (body: Record<string, unknown>) => {
        const { req, res } = createMocks({ method: 'POST', query: nextScope, body });
        await coldCallRoute(req as any, res as any);
        return res;
      };
      const drawn = (await nextCall({ action: 'draw' }))._getJSONData();
      await prisma.rosterEntry.update({
        where: { courseId_userId: { courseId: scope.courseId, userId: ended.id } },
        data: { active: false },
      });
      const inactive = await nextCall({ action: 'record', outcome: 'absent', draw: drawn.draw });
      expect(inactive._getStatusCode()).toBe(409);
      expect(inactive._getJSONData().message).toBe('This student can no longer be called');
    });

    it('keeps an excused Absent from freeing its draw for a second Absent', async () => {
      await student('Ola');
      const { draw: token } = await draw();
      const callId = (await record(token, 'absent'))._getJSONData().id;
      (requireIdentity as jest.Mock).mockResolvedValue({ user: { id: 'instructor' }, admin: true });
      const { req, res } = createMocks({
        method: 'POST',
        query: { courseId: scope.courseId },
        body: {
          courseId: scope.courseId,
          action: 'excuse',
          classId: scope.classId,
          callId,
          reason: 'Nurse',
        },
      });
      await courseReportRoute(req as any, res as any);
      expect(res._getStatusCode()).toBe(200);
      const again = await record(token, 'absent');
      expect(again._getStatusCode()).toBe(409);
      expect(again._getJSONData().message).toBe('This call is already recorded');
    });

    it('accepts a follow-up answer after the session ends', async () => {
      await student('Ren');
      const { followUp } = (await record((await draw()).draw))._getJSONData();
      await appendEvent(prisma, { ...scope, actorId: 'system', kind: 'SESSION_ENDED' });
      const late = await call('POST', { action: 'record', outcome: 'answered', followUp });
      expect(late._getStatusCode()).toBe(200);
    });

    it('accepts the corrected outcome after an undo, for a draw and for a follow-up', async () => {
      await student('Pia');
      const { draw: token } = await draw();
      const passed = await record(token, 'pass');
      await call('POST', { action: 'undo', eventId: passed._getJSONData().id });
      const answered = await record(token, 'answered');
      expect(answered._getStatusCode()).toBe(200);
      const { followUp } = answered._getJSONData();
      const second = await call('POST', { action: 'record', outcome: 'answered', followUp });
      await call('POST', { action: 'undo', eventId: second._getJSONData().id });
      // The earlier follow-up token is current again once the later call is undone.
      const corrected = await call('POST', { action: 'record', outcome: 'pass', followUp });
      expect(corrected._getStatusCode()).toBe(200);
    });

    it('takes roll call in hosted mode with the same check-in events', async () => {
      const ada = await prisma.user.create({
        data: { email: `roll-${randomUUID()}@example.edu`, displayName: 'Ada' },
      });
      await prisma.rosterEntry.create({ data: { courseId: scope.courseId, userId: ada.id } });
      expect((await call('POST', { action: 'roll-call' }))._getStatusCode()).toBe(409);
      process.env.CHECKHEN_MODE = 'hosted';
      try {
        const roster = (await call('POST', { action: 'roll-call' }))._getJSONData().students;
        expect(roster.find((entry: any) => entry.userId === ada.id)).toMatchObject({
          present: false,
        });
        const marked = await call('POST', { action: 'mark', userId: ada.id, present: true });
        expect(
          marked._getJSONData().students.find((entry: any) => entry.userId === ada.id).present
        ).toBe(true);
        // Marking twice writes one check-in.
        await call('POST', { action: 'mark', userId: ada.id, present: true });
        const checkIns = (await readEvents(prisma, scope)).filter(
          (event) => event.kind === 'CHECK_IN' && event.userId === ada.id
        );
        expect(checkIns).toHaveLength(1);
        expect(checkIns[0].payload).toMatchObject({ rollCall: true });
        // A roll-called student can be cold-called.
        expect((await draw()).student.userId).toBe(ada.id);
        await call('POST', { action: 'mark', userId: ada.id, present: false });
        const state = await readState(prisma, scope);
        expect(state.attendance.find((entry) => entry.userId === ada.id)?.isPresent).toBeFalsy();
        // Present then Absent is a correction: the session does not count as attended.
        (requireIdentity as jest.Mock).mockResolvedValue({
          user: { id: 'instructor' },
          admin: true,
        });
        const attended = async () => {
          const { req, res } = createMocks({ method: 'GET', query: { courseId: scope.courseId } });
          await courseReportRoute(req as any, res as any);
          return res
            ._getJSONData()
            .report.students.find((row: any) => row.userId === ada.id).sessionsAttended;
        };
        expect(await attended()).toBe(0);
        // Marking Present again restores the credit.
        await call('POST', { action: 'mark', userId: ada.id, present: true });
        expect(await attended()).toBe(1);
        // A student removed from the roster cannot be marked.
        await prisma.rosterEntry.update({
          where: { courseId_userId: { courseId: scope.courseId, userId: ada.id } },
          data: { active: false },
        });
        const refused = await call('POST', { action: 'mark', userId: ada.id, present: false });
        expect(refused._getStatusCode()).toBe(400);
      } finally {
        delete process.env.CHECKHEN_MODE;
      }
    });

    it('makes an absent student callable again when they check back in', async () => {
      const late = await student('Kim');
      await record((await draw()).draw, 'absent');
      expect((await call('POST', { action: 'draw' }))._getStatusCode()).toBe(409);
      await appendEvent(prisma, {
        ...scope,
        actorId: late.id,
        userId: late.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: 'Anon Kim' },
      });
      expect((await draw()).student.userId).toBe(late.id);
    });

    it('records a skip that changes nothing', async () => {
      const away = await student('Sol');
      const skipped = await record((await draw()).draw, 'skip');
      expect(skipped._getStatusCode()).toBe(200);
      expect((await draw()).student.userId).toBe(away.id);
      expect((await call('GET'))._getJSONData().calls).toEqual([
        expect.objectContaining({ userId: away.id, outcome: 'skip' }),
      ]);
    });

    it('records follow-ups on the same student, each counted, and refuses stale ones', async () => {
      const keen = await student('Ari');
      const first = await call('POST', {
        action: 'record',
        outcome: 'answered',
        draw: (await draw()).draw,
        next: 'follow-up',
      });
      const { id: firstId, followUp } = first._getJSONData();
      expect(followUp).toEqual(expect.any(String));
      const followUpRecord = (outcome: string, token = followUp, next?: string) =>
        call('POST', { action: 'record', outcome, followUp: token, next });
      // Absent and Skip are not follow-up outcomes.
      expect((await followUpRecord('absent'))._getStatusCode()).toBe(400);
      expect((await followUpRecord('skip'))._getStatusCode()).toBe(400);
      // A double tap on one follow-up records once.
      const pair = await Promise.all([
        followUpRecord('answered', followUp, 'follow-up'),
        followUpRecord('pass'),
      ]);
      expect(statuses(pair)).toEqual([200, 409]);
      const calls = (await readEvents(prisma, scope)).filter((event) => event.kind === 'COLD_CALL');
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({ userId: keen.id, payload: { followUpOf: firstId } });
      // A newer draw ends the run: an outstanding follow-up token is refused.
      const third = await call('POST', {
        action: 'record',
        outcome: 'answered',
        draw: (await draw()).draw,
        next: 'follow-up',
      });
      await draw();
      const late = await followUpRecord('answered', third._getJSONData().followUp);
      expect(late._getStatusCode()).toBe(409);
      expect(late._getJSONData().message).toBe('This follow-up is no longer current');
    });

    describe('course record', () => {
      const report = async (method: 'GET' | 'POST', body?: Record<string, unknown>, query = {}) => {
        const { req, res } = createMocks({
          method,
          query: { courseId: scope.courseId, ...query },
          body: body && { courseId: scope.courseId, ...body },
        });
        await courseReportRoute(req as any, res as any);
        return res;
      };
      beforeEach(() => {
        (requireIdentity as jest.Mock).mockResolvedValue({
          user: { id: 'instructor' },
          admin: true,
        });
      });

      it('excuses an absence, keeps both events, and drops it from opportunities', async () => {
        const eve = await student('Eve');
        const absent = await record((await draw()).draw, 'absent');
        const callId = absent._getJSONData().id;
        const before = (await report('GET'))._getJSONData().report;
        expect(before.students.find((row: any) => row.userId === eve.id)).toMatchObject({
          absences: 1,
          opportunities: 1,
        });
        const excuse = (reason: string, id = callId) =>
          report('POST', { action: 'excuse', classId: scope.classId, callId: id, reason });
        expect((await excuse(''))._getStatusCode()).toBe(400);
        expect((await excuse('Nurse visit'))._getStatusCode()).toBe(200);
        expect((await excuse('Again'))._getStatusCode()).toBe(409);
        // Eve left (checked out); a second student gives a call that is not an absence.
        await student('Gus');
        const answered = await record((await draw()).draw, 'answered');
        expect((await excuse('Not an absence', answered._getJSONData().id))._getStatusCode()).toBe(
          404
        );
        const after = (await report('GET'))._getJSONData().report;
        expect(after.students.find((row: any) => row.userId === eve.id)).toMatchObject({
          absences: 0,
          excusedAbsences: 1,
          answers: 0,
          opportunities: 0,
        });
        expect(after.absences).toEqual([
          expect.objectContaining({ callId, excused: true, reason: 'Nurse visit' }),
        ]);
        const events = await readEvents(prisma, scope);
        expect(events.find((event) => event.id === callId)?.kind).toBe('COLD_CALL');
        expect(events.find((event) => event.kind === 'COLD_CALL_EXCUSED')?.supersedesId).toBe(
          callId
        );
        // An excused absence cannot then be undone from the call screen.
        expect((await call('POST', { action: 'undo', eventId: callId }))._getStatusCode()).toBe(
          409
        );
      });

      it('undoes an excuse so the absence counts again, and allows a new excuse', async () => {
        const kai = await student('Kai');
        const callId = (await record((await draw()).draw, 'absent'))._getJSONData().id;
        const post = (action: string, reason?: string) =>
          report('POST', { action, classId: scope.classId, callId, reason });
        const row = async () =>
          (await report('GET'))
            ._getJSONData()
            .report.students.find((r: any) => r.userId === kai.id);
        expect((await post('unexcuse'))._getStatusCode()).toBe(404);
        expect((await post('excuse', 'Nurse visit'))._getStatusCode()).toBe(200);
        expect(await row()).toMatchObject({ absences: 0, excusedAbsences: 1, opportunities: 0 });
        expect((await post('unexcuse'))._getStatusCode()).toBe(200);
        expect(await row()).toMatchObject({ absences: 1, excusedAbsences: 0, opportunities: 1 });
        expect((await post('unexcuse'))._getStatusCode()).toBe(409);
        // The absence is in force again, so it can be excused again.
        expect((await post('excuse', 'Doctor note'))._getStatusCode()).toBe(200);
        expect(await row()).toMatchObject({ absences: 0, excusedAbsences: 1 });
        const events = await readEvents(prisma, scope);
        expect(events.filter((event) => event.kind === 'COLD_CALL_EXCUSED')).toHaveLength(2);
        expect(events.find((event) => event.id === callId)?.kind).toBe('COLD_CALL');
      });

      it('uses the defaults, and says so, when saved settings break the grade', async () => {
        await prisma.course.update({
          where: { id: scope.courseId },
          data: { config: { A_min: 0, A_max: 0, ratio: 0.5 } },
        });
        const data = (await report('GET'))._getJSONData();
        expect(data.configProblem).toBe(
          'The lowest and highest A must be whole numbers of at least 1'
        );
        // Only the A bounds fall back; the valid ratio stays in force.
        expect(data.config).toMatchObject({ A_min: 3, A_max: 8, ratio: 0.5 });
      });

      it('saves only valid settings and stamps them on every CSV row', async () => {
        await student('Fay');
        const saved = await report('POST', {
          action: 'config',
          config: { term_meetings: 26, ratio: 0.5 },
        });
        expect(saved._getStatusCode()).toBe(200);
        expect(saved._getJSONData().config).toMatchObject({
          term_meetings: 26,
          ratio: 0.5,
          A_min: 3,
        });
        const refused = async (config: Record<string, unknown>) => {
          const res = await report('POST', { action: 'config', config });
          expect(res._getStatusCode()).toBe(400);
          return res._getJSONData().message;
        };
        expect(await refused({ ratio: -1 })).toBe('Enter a number of at least 0 for ratio');
        expect(await refused({ A: 5 })).toBe('Unknown setting: A');
        expect(await refused({ A_min: 9, A_max: 4 })).toBe(
          'The lowest A must not exceed the highest A'
        );
        expect(await refused({ A_min: 0, A_max: 0 })).toBe(
          'The lowest and highest A must be whole numbers of at least 1'
        );
        expect(await refused({ A_max: 2.5 })).toBe(
          'The lowest and highest A must be whole numbers of at least 1'
        );
        expect(await refused({ ratio: 0 })).toBe('The target ratio must be more than 0');
        expect(await refused({ component_weight: 2 })).toBe(
          'The share of the course grade must be at most 1'
        );
        expect(await refused({ term_meetings: 2.5 })).toBe(
          'Meetings in the term must be a whole number of at least 1, or empty'
        );
        // Inherited names are not settings.
        expect(await refused({ toString: 1 })).toBe('Unknown setting: toString');
        expect(await refused(JSON.parse('{"__proto__": 1}'))).toBe('Unknown setting: __proto__');
        // A partial body keeps the settings it leaves out.
        const partial = await report('POST', { action: 'config', config: { ratio: 0.6 } });
        expect(partial._getJSONData().config).toMatchObject({ term_meetings: 26, ratio: 0.6 });
        await report('POST', { action: 'config', config: { ratio: 0.5 } });
        const csv = await report('GET', undefined, { format: 'csv', view: 'students' });
        expect(csv._getHeaders()['content-type']).toBe('text/csv; charset=utf-8');
        // A byte-order mark makes Excel read the file as UTF-8.
        expect(String(csv._getData()).startsWith('\uFEFFstudent_id,')).toBe(true);
        const [header, ...rows] = String(csv._getData()).trim().split('\r\n');
        const columns = header.split(',');
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          const cells = row.split(',');
          expect(cells[columns.indexOf('config_term_meetings')]).toBe('26');
          expect(cells[columns.indexOf('config_ratio')]).toBe('0.5');
        }
        const sessionsCsv = await report('GET', undefined, { format: 'csv', view: 'sessions' });
        expect(String(sessionsCsv._getData())).toContain(scope.classId);
      });
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

  it('records each drop once, and a later drop after an excuse as a new fail', async () => {
    await invoke(checkIn, '172.16.77.20');
    const examId = randomUUID();
    await appendEvent(prisma, {
      ...scope,
      actorId: 'instructor',
      kind: 'EXAM_STARTED',
      payload: { examId, domains: ['exam.example.edu'], thresholdSeconds: 30 },
    });
    // A retried callback reports the same drop twice.
    await recordExamFail(scope, { examId, userId: user.id, failId: 'drop-1' });
    await recordExamFail(scope, { examId, userId: user.id, failId: 'drop-1' });
    let fails = (await readState(prisma, scope)).examFails;
    expect(fails).toHaveLength(1);
    await appendEvent(prisma, {
      ...scope,
      actorId: 'instructor',
      userId: user.id,
      kind: 'EXAM_EXCUSED',
      payload: { examId, reason: 'AP outage' },
      supersedesId: fails[0].id,
    });
    await recordExamFail(scope, { examId, userId: user.id, failId: 'drop-2' });
    fails = (await readState(prisma, scope)).examFails;
    expect(fails.map((fail) => fail.excused)).toEqual([true, false]);
    // The fails stay listed after the exam ends.
    await appendEvent(prisma, {
      ...scope,
      actorId: 'instructor',
      kind: 'EXAM_ENDED',
      payload: { examId },
    });
    expect((await readState(prisma, scope)).examFails).toHaveLength(2);
  });

  it('seeds a demo course that every view can read, and resets to a new one', async () => {
    const {
      seedDemo,
      currentDemoCourse,
      demoCourseOrSeed,
      demoDatabaseProblem,
      DEMO_DATABASE_REFUSED,
    } = jest.requireActual('@/lib/demo');
    // Two first visits at once seed one course.
    const before = await prisma.course.count({ where: { demo: true } });
    const [one, two] = await Promise.all([demoCourseOrSeed(prisma), demoCourseOrSeed(prisma)]);
    expect(one.id).toBe(two.id);
    expect(await prisma.course.count({ where: { demo: true } })).toBe(before + 1);
    // A course created by name alone is never the demo; only the seed marks one.
    const named = await prisma.course.create({ data: { name: 'Demo: Farm Science 101' } });
    const first = await seedDemo(prisma, new Date('2026-10-06T18:00:00Z'));
    expect((await currentDemoCourse(prisma)).id).toBe(first.courseId);
    await prisma.course.create({ data: { name: 'Demo: Farm Science 101' } });
    expect((await currentDemoCourse(prisma)).id).toBe(first.courseId);
    // This database holds real test courses, so demo mode refuses it. An empty course
    // holds no data, but one with a roster does.
    expect(await demoDatabaseProblem(prisma)).toBe(DEMO_DATABASE_REFUSED);
    const counted = await prisma.course.count({
      where: { demo: false, OR: [{ classes: { some: {} } }, { roster: { some: {} } }] },
    });
    const real = await prisma.user.create({ data: { email: `real-${randomUUID()}@bu.edu` } });
    await prisma.rosterEntry.create({ data: { courseId: named.id, userId: real.id } });
    expect(
      await prisma.course.count({
        where: { demo: false, OR: [{ classes: { some: {} } }, { roster: { some: {} } }] },
      })
    ).toBe(counted + 1);
    const live = { courseId: first.courseId, classId: first.liveClassId };
    const state = await readState(prisma, live);
    expect(state.attendance.filter((entry) => entry.isPresent)).toHaveLength(10);
    // Every past meeting folds without error and ended.
    const sessions = await prisma.class.findMany({ where: { courseId: first.courseId } });
    expect(sessions).toHaveLength(5);
    for (const session of sessions.filter((s) => s.id !== first.liveClassId)) {
      const past = await readState(prisma, { courseId: first.courseId, classId: session.id });
      expect(past.endedAt).not.toBeNull();
    }
    const events = await prisma.participationEvent.findMany({
      where: { courseId: first.courseId },
    });
    const outcomes = new Set(
      events.filter((e) => e.kind === 'COLD_CALL').map((e) => (e.payload as any).outcome)
    );
    expect(Array.from(outcomes).sort()).toEqual(['absent', 'answered', 'pass', 'retry', 'skip']);
    expect(events.some((e) => e.kind === 'COLD_CALL_EXCUSED')).toBe(true);
    expect(events.some((e) => (e.payload as any).followUpOf)).toBe(true);
    // A visitor edits a persona; the reset restores every profile field.
    const clover = 'clover@demo.checkhen.invalid';
    await prisma.user.update({
      where: { email: clover },
      data: { bio: 'spam', pronouns: 'x', namePronunciation: 'y', foodAllergies: 'z' },
    });
    // Reset: a new course from the same seed becomes the demo; the old one is untouched.
    const second = await seedDemo(prisma, new Date('2026-10-06T19:00:00Z'));
    expect(await prisma.user.findUnique({ where: { email: clover } })).toMatchObject({
      bio: null,
      pronouns: 'they/them',
      namePronunciation: null,
      foodAllergies: null,
    });
    expect(second.courseId).not.toBe(first.courseId);
    expect((await currentDemoCourse(prisma)).id).toBe(second.courseId);
    expect(await prisma.participationEvent.count({ where: { courseId: first.courseId } })).toBe(
      events.length
    );
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
