/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { createMocks } from 'node-mocks-http';
import { prisma } from '@/lib/prisma';
import { readEvents, readState } from '@/lib/event-store';
import { requireScope } from '@/lib/request-scope';
import { bindDevice, revokeCurrentDevice, revokeStudentDevices } from '@/lib/portal-binding';
import { revokeSessionDevices } from '@/lib/portal-binding';
import { expireSessions } from '@/lib/session-expiry';
import checkIn from '@/pages/api/student/check-in';
import checkOut from '@/pages/api/student/check-out';

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
});
