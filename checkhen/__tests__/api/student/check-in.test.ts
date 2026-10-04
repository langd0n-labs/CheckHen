import { createMocks } from 'node-mocks-http';
import { generateUniqueAnonymousName } from '@/lib/anonymousNames';
import { appendEvent, readState } from '@/lib/event-store';
import { bindDevice, PortalBindingError, revokeDevice } from '@/lib/portal-binding';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import handler from '@/pages/api/student/check-in';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/anonymousNames', () => ({ generateUniqueAnonymousName: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('@/lib/portal-binding', () => ({
  bindDevice: jest.fn(),
  revokeDevice: jest.fn(),
  revokeCurrentDevice: jest.fn(),
  revokeStudentDevices: jest.fn(),
  revokeSessionDevices: jest.fn(),
  PortalBindingError: class PortalBindingError extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));

const user = { id: 'student', email: 'student@bu.edu' };
const selected = { id: 'session-a', courseId: 'course-a', createdAt: new Date(), duration: 60 };
const scope = { courseId: 'course-a', classId: 'session-a' };
const empty = () => ({
  attendance: [] as Array<{ userId: string; anonymousName: string; isPresent: boolean }>,
  hands: [],
  pace: [],
  messages: [],
  endedAt: null as Date | null,
});
const invoke = async (method: 'GET' | 'POST', state = empty()) => {
  (readState as jest.Mock).mockResolvedValue(state);
  const { req, res } = createMocks({ method, query: scope });
  await handler(req as any, res as any);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: false });
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event-1', createdAt: new Date() });
  (generateUniqueAnonymousName as jest.Mock).mockReturnValue('Calm Otter');
  (bindDevice as jest.Mock).mockResolvedValue(null);
  (revokeDevice as jest.Mock).mockResolvedValue(undefined);
});

describe('POST /api/student/check-in', () => {
  it('rejects wrong methods', async () => expect((await invoke('GET'))._getStatusCode()).toBe(405));
  it('returns 401 without a session', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(401).json({ message: 'Unauthorized' }); return null; });
    expect((await invoke('POST'))._getStatusCode()).toBe(401);
    expect(bindDevice).not.toHaveBeenCalled();
  });
  it('returns 404 without a selected class', async () => {
    (requireScope as jest.Mock).mockImplementation(async (_req, res) => { res.status(404).json({ message: 'No class' }); return null; });
    expect((await invoke('POST'))._getStatusCode()).toBe(404);
  });
  it('rejects an ended session without recording a check-in event', async () => {
    expect((await invoke('POST', { ...empty(), endedAt: new Date() }))._getStatusCode()).toBe(400);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('records a check-in event with a unique anonymous name', async () => {
    const res = await invoke('POST', {
      ...empty(),
      attendance: [{ userId: 'other', anonymousName: 'Swift Panda', isPresent: true }],
    });
    expect(res._getStatusCode()).toBe(200);
    expect(generateUniqueAnonymousName).toHaveBeenCalledWith(['Swift Panda']);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        ...scope,
        userId: user.id,
        kind: 'CHECK_IN',
        payload: { anonymousName: 'Calm Otter' },
      })
    );
  });
  it('does not duplicate an active check-in', async () => {
    const res = await invoke('POST', {
      ...empty(),
      attendance: [{ userId: user.id, anonymousName: 'Swift Panda', isPresent: true }],
    });
    expect(res._getStatusCode()).toBe(200);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('records the lease IP and MAC after portal authorization', async () => {
    (bindDevice as jest.Mock).mockResolvedValue({ ip: '172.16.77.20', mac: '02:00:00:00:00:20' });
    const res = await invoke('POST');
    expect(res._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        kind: 'CHECK_IN',
        payload: {
          anonymousName: 'Calm Otter',
          deviceIp: '172.16.77.20',
          deviceMac: '02:00:00:00:00:20',
        },
      })
    );
  });
  it('binds a second device without changing attendance', async () => {
    (bindDevice as jest.Mock).mockResolvedValue({ ip: '172.16.77.21', mac: '02:00:00:00:00:21' });
    const res = await invoke('POST', {
      ...empty(),
      attendance: [{ userId: user.id, anonymousName: 'Swift Panda', isPresent: true }],
    });
    expect(res._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        kind: 'DEVICE_BOUND',
        payload: { deviceIp: '172.16.77.21', deviceMac: '02:00:00:00:00:21' },
      })
    );
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });
  it('rejects a client without an AP lease', async () => {
    (bindDevice as jest.Mock).mockRejectedValue(new PortalBindingError('AP lease not found', 403));
    const res = await invoke('POST');
    expect(res._getStatusCode()).toBe(403);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('returns 403 when the agent rejects an outside-subnet client', async () => {
    (bindDevice as jest.Mock).mockRejectedValue(new PortalBindingError('Outside AP subnet', 403));
    expect((await invoke('POST'))._getStatusCode()).toBe(403);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('returns 503 when the portal agent is unavailable', async () => {
    (bindDevice as jest.Mock).mockRejectedValue(new PortalBindingError('Portal agent unavailable', 503));
    expect((await invoke('POST'))._getStatusCode()).toBe(503);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('reverses a network bind when the event append fails', async () => {
    (bindDevice as jest.Mock).mockResolvedValue({ ip: '172.16.77.20', mac: '02:00:00:00:00:20' });
    (appendEvent as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
    await expect(invoke('POST')).rejects.toThrow('Database unavailable');
    expect(revokeDevice).toHaveBeenCalledWith(
      { ip: '172.16.77.20', mac: '02:00:00:00:00:20' },
      scope,
      user
    );
  });
});
