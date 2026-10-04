import { createMocks } from 'node-mocks-http';
import { requireScope, isInstructor } from '@/lib/request-scope';
import { appendEvent, readState } from '@/lib/event-store';
import { prisma } from '@/lib/prisma';
import { generateUniqueAnonymousName } from '@/lib/anonymousNames';
import checkIn from '@/pages/api/student/check-in';
import checkOut from '@/pages/api/student/check-out';
import sendChat from '@/pages/api/student/send-chat';
import startup from '@/pages/api/student/startup';
import fetchAllChat from '@/pages/api/student/fetch-all-chat';
import fetchLastChat from '@/pages/api/student/fetch-last-chat';
import endClass from '@/pages/api/admin/end-class-early';
import { bindDevice, revokeCurrentDevice, revokeDevice, revokeSessionDevices, revokeStudentDevices } from '@/lib/portal-binding';
import paceSignal from '@/pages/api/student/send-pace-signal';
import acknowledge from '@/pages/api/admin/ack-hand-raise';
import fetchCheckIns from '@/pages/api/admin/fetch-check-ins';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn(), isInstructor: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn(), findMany: jest.fn() } } }));
jest.mock('@/lib/anonymousNames', () => ({ generateUniqueAnonymousName: jest.fn() }));
jest.mock('@/lib/portal-binding', () => ({
  PortalBindingError: class PortalBindingError extends Error { status = 503; },
  bindDevice: jest.fn().mockResolvedValue(null), revokeDevice: jest.fn(),
  revokeCurrentDevice: jest.fn(), revokeStudentDevices: jest.fn(), revokeSessionDevices: jest.fn(),
}));

const user = { id: 'student', email: 'student@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', name: 'Class A', createdAt: new Date(), duration: 60 };
const scope = { courseId: selected.courseId, classId: selected.id };
const empty = () => ({ attendance: [], hands: [], pace: [], messages: [], endedAt: null });
const checkedIn = () => ({ ...empty(), attendance: [{
  id: 'checkin-1', userId: user.id, classId: selected.id, anonymousName: 'Swift Panda',
  createdAt: new Date(), checkOutTime: null, isPresent: true,
}] });
const invoke = async (handler: typeof checkIn, method: 'GET' | 'POST', body: Record<string, unknown> = {}) => {
  const { req, res } = createMocks({ method, body, query: scope });
  await handler(req as any, res as any);
  return res;
};
beforeEach(() => {
  jest.clearAllMocks();
  (bindDevice as jest.Mock).mockResolvedValue(null);
  (revokeDevice as jest.Mock).mockResolvedValue(undefined);
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: false });
  (readState as jest.Mock).mockResolvedValue(empty());
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
  (generateUniqueAnonymousName as jest.Mock).mockReturnValue('Calm Otter');
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
  (prisma.user.findMany as jest.Mock).mockResolvedValue([user]);
  (isInstructor as jest.Mock).mockReturnValue(false);
});

describe('event-backed check-in', () => {
  it('rejects a non-POST request', async () => expect((await invoke(checkIn, 'GET'))._getStatusCode()).toBe(405));
  it('rejects a missing or invalid scope', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(404).json({ message: 'Not found' }); return null; });
    expect((await invoke(checkIn, 'POST'))._getStatusCode()).toBe(404);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('rejects an ended session', async () => {
    (readState as jest.Mock).mockResolvedValue({ ...empty(), endedAt: new Date() });
    expect((await invoke(checkIn, 'POST'))._getStatusCode()).toBe(400);
  });
  it('adds a check-in fact with an unused anonymous name', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    const otherUser = { ...user, id: 'other' };
    (requireScope as jest.Mock).mockResolvedValue({ scope, user: otherUser, selected });
    expect((await invoke(checkIn, 'POST'))._getStatusCode()).toBe(200);
    expect(generateUniqueAnonymousName).toHaveBeenCalledWith(['Swift Panda']);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ ...scope, userId: 'other', kind: 'CHECK_IN', payload: { anonymousName: 'Calm Otter' } }));
  });
  it('does not duplicate an active check-in', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(checkIn, 'POST'))._getStatusCode()).toBe(200);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('keeps an existing binding when check-in is repeated', async () => {
    (readState as jest.Mock).mockResolvedValue({ ...checkedIn(), attendance: [{
      ...checkedIn().attendance[0], devices: [{ ip: '172.16.77.20', mac: '02:00:00:00:00:20' }],
    }] });
    (bindDevice as jest.Mock).mockResolvedValue({ ip: '172.16.77.20', mac: '02:00:00:00:00:20' });
    expect((await invoke(checkIn, 'POST'))._getStatusCode()).toBe(200);
    expect(appendEvent).not.toHaveBeenCalled();
    expect(revokeDevice).not.toHaveBeenCalled();
  });
  it('preserves an append failure when cleanup of a new binding also fails', async () => {
    (readState as jest.Mock).mockResolvedValue({ ...checkedIn(), attendance: [{
      ...checkedIn().attendance[0], devices: [{ ip: '172.16.77.20', mac: '02:00:00:00:00:20' }],
    }] });
    (bindDevice as jest.Mock).mockResolvedValue({ ip: '172.16.77.21', mac: '02:00:00:00:00:21' });
    const original = new Error('append failed');
    (appendEvent as jest.Mock).mockRejectedValue(original);
    (revokeDevice as jest.Mock).mockRejectedValue(new Error('cleanup failed'));
    await expect(invoke(checkIn, 'POST')).rejects.toBe(original);
    expect(revokeDevice).toHaveBeenCalledWith({ ip: '172.16.77.21', mac: '02:00:00:00:00:21' }, scope, user);
  });
  it('records a new check-in after checkout and retains the name', async () => {
    const state = checkedIn();
    state.attendance[0].isPresent = false;
    (readState as jest.Mock).mockResolvedValue(state);
    await invoke(checkIn, 'POST');
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'CHECK_IN', payload: { anonymousName: 'Swift Panda' } }));
  });
  it('revokes all student devices before checkout', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(checkOut, 'POST'))._getStatusCode()).toBe(200);
    expect(revokeStudentDevices).toHaveBeenCalledWith(scope, user);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'CHECK_OUT' }));
  });
  it('leaves attendance present when a second device checks out', async () => {
    (readState as jest.Mock).mockResolvedValue({ ...checkedIn(), attendance: [{
      ...checkedIn().attendance[0], deviceIp: '172.16.77.20', devices: [
        { ip: '172.16.77.20', mac: '02:00:00:00:00:20' },
        { ip: '172.16.77.21', mac: '02:00:00:00:00:21' },
      ],
    }] });
    const { req, res } = createMocks({ method: 'POST', query: scope,
      headers: { 'x-real-ip': '172.16.77.21' } });
    await checkOut(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(revokeCurrentDevice).toHaveBeenCalledWith(req, scope, user);
    expect(revokeStudentDevices).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({
      kind: 'DEVICE_UNBOUND', payload: { deviceIp: '172.16.77.21' },
    }));
  });
  it('revokes session devices before ending class', async () => {
    expect((await invoke(endClass, 'POST'))._getStatusCode()).toBe(200);
    expect(revokeSessionDevices).toHaveBeenCalledWith(scope);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'SESSION_ENDED' }));
  });
});

describe('event-backed chat and pace', () => {
  it('does not expose stable user IDs in student chat responses', async () => {
    const message = { id: 'message-1', userId: 'student', classId: scope.classId,
      message: 'Hello', anonymousName: 'Swift Panda', createdAt: new Date() };
    (readState as jest.Mock).mockResolvedValue({ ...checkedIn(), messages: [message] });
    for (const route of [startup, fetchAllChat, fetchLastChat]) {
      const res = await invoke(route as typeof checkIn, 'GET');
      const payload = res._getJSONData();
      const messages = route === startup ? payload.messages : JSON.parse(payload.message);
      expect(messages[0]).not.toHaveProperty('userId');
      expect(messages[0]).toMatchObject({ message: 'Hello', anonymousName: 'Swift Panda' });
    }
  });
  it.each(['', '   ', 'x'.repeat(1001)])('rejects an invalid chat body', async message => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(sendChat, 'POST', { message }))._getStatusCode()).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('requires a current check-in before chat', async () => {
    expect((await invoke(sendChat, 'POST', { message: 'Question' }))._getStatusCode()).toBe(400);
  });
  it('writes a chat fact with the anonymous name', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(sendChat, 'POST', { message: 'Question' }))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({
      ...scope, kind: 'CHAT_MESSAGE', payload: { message: 'Question', anonymousName: 'Swift Panda' },
    }));
  });
  it('accepts a 1000-character chat body', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(sendChat, 'POST', { message: 'x'.repeat(1000) }))._getStatusCode()).toBe(200);
  });
  it.each(['invalid', '', undefined])('rejects an invalid pace signal', async signalType => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(paceSignal, 'POST', { signalType }))._getStatusCode()).toBe(400);
  });
  it('adds a pace event without deleting a prior signal', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    expect((await invoke(paceSignal, 'POST', { signalType: 'slow_down' }))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'PACE_SIGNAL', payload: { signalType: 'slow_down' } }));
  });
});

describe('instructor actions', () => {
  it('scopes hand acknowledgement to the selected session', async () => {
    (readState as jest.Mock).mockResolvedValue({ ...empty(), hands: [{ id: 'hand-1', userId: 'target', isAcknowledged: false }] });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'target', email: 'target@bu.edu' });
    expect((await invoke(acknowledge, 'POST', { email: 'target@bu.edu' }))._getStatusCode()).toBe(200);
    expect(requireScope).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    expect(appendEvent).toHaveBeenCalledWith(prisma, expect.objectContaining({
      ...scope, kind: 'HAND_ACKNOWLEDGED', userId: 'target', payload: { handRaiseId: 'hand-1' },
    }));
  });
  it('returns 404 when the selected session has no matching hand', async () => {
    expect((await invoke(acknowledge, 'POST', { email: 'target@bu.edu' }))._getStatusCode()).toBe(404);
  });
  it('derives instructor attendance and hand count from selected event state', async () => {
    (readState as jest.Mock).mockResolvedValue({ ...checkedIn(), hands: [
      { id: 'hand-1', userId: user.id }, { id: 'hand-2', userId: user.id },
    ] });
    const res = await invoke(fetchCheckIns, 'GET');
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getJSONData().message)[0]).toMatchObject({ anonymousName: 'Swift Panda', handRaiseCount: 2 });
    expect(readState).toHaveBeenCalledWith(prisma, scope);
  });
  it('excludes instructor records from attendance display', async () => {
    (readState as jest.Mock).mockResolvedValue(checkedIn());
    (isInstructor as jest.Mock).mockReturnValue(true);
    expect(JSON.parse((await invoke(fetchCheckIns, 'GET'))._getJSONData().message)).toEqual([]);
  });
});
