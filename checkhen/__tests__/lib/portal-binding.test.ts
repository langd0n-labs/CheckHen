import { bindDevice, PortalBindingError, revokeCurrentDevice, revokeSessionDevices, revokeStudentDevices } from '@/lib/portal-binding';

const scope = { courseId: 'course-a', classId: 'class-a' };
const user = { id: 'student-a' };
const request = (ip: string) => ({ headers: { 'x-real-ip': ip } }) as any;

beforeEach(() => {
  process.env.PORTAL_AGENT_URL = 'http://127.0.0.1:7878';
  process.env.PORTAL_CONTROL_SECRET = 'test-secret';
  global.fetch = jest.fn();
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: jest.fn(() => undefined) });
});

afterEach(() => {
  delete process.env.PORTAL_AGENT_URL;
  delete process.env.PORTAL_CONTROL_SECRET;
  jest.restoreAllMocks();
});

it('rejects attendance when the AP agent is not configured', async () => {
  delete process.env.PORTAL_AGENT_URL;
  await expect(bindDevice(request('172.16.77.20'), scope, user))
    .rejects.toMatchObject({ status: 503 });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('rejects a request outside the AP subnet before contacting the agent', async () => {
  await expect(bindDevice(request('192.0.2.20'), scope, user))
    .rejects.toMatchObject({ status: 403 });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('rejects a missing proxy client address before contacting the agent', async () => {
  await expect(bindDevice(request(''), scope, user))
    .rejects.toBeInstanceOf(PortalBindingError);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('rejects a forged or invalid proxy address', async () => {
  await expect(bindDevice(request('172.16.77.20, 192.0.2.1'), scope, user))
    .rejects.toMatchObject({ status: 403 });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('accepts an AP SLAAC address and rejects an unrelated IPv6 address', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({
    ip: 'fd9b:2f69:8c44::20', mac: '02:00:00:00:00:20',
  }) });
  await expect(bindDevice(request('fd9b:2f69:8c44::20'), scope, user))
    .resolves.toMatchObject({ ip: 'fd9b:2f69:8c44::20' });
  await expect(bindDevice(request('2001:db8::20'), scope, user))
    .rejects.toMatchObject({ status: 403 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('maps an agent failure to 503', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  await expect(bindDevice(request('172.16.77.20'), scope, user))
    .rejects.toMatchObject({ status: 503 });
});

it('sends a timed request and maps a timeout to 503', async () => {
  (global.fetch as jest.Mock).mockRejectedValue(new Error('Timeout'));
  await expect(bindDevice(request('172.16.77.20'), scope, user))
    .rejects.toMatchObject({ status: 503 });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(3000);
});

it('sends signed bulk revocations for checkout and session end', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
  await revokeStudentDevices(scope, user);
  await revokeSessionDevices(scope);
  expect((global.fetch as jest.Mock).mock.calls.map(call => call[0])).toEqual([
    'http://127.0.0.1:7878/revoke-student', 'http://127.0.0.1:7878/revoke-session',
  ]);
  for (const [, options] of (global.fetch as jest.Mock).mock.calls) {
    expect(options.headers['X-CheckHen-Signature']).toMatch(/^[0-9a-f]{64}$/);
  }
});

it('revokes only the requesting second device', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({
    ip: '172.16.77.21', mac: '02:00:00:00:00:21',
  }) });
  await revokeCurrentDevice(request('172.16.77.21'), scope, user);
  expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:7878/revoke',
    expect.objectContaining({ body: expect.stringContaining('172.16.77.21') }));
});
