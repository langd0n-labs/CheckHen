import { bindDevice, PortalBindingError } from '@/lib/portal-binding';

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

it('rejects a request outside the AP subnet when the agent denies it', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
  await expect(bindDevice(request('192.0.2.20'), scope, user))
    .rejects.toMatchObject({ status: 403 });
  expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:7878/bind',
    expect.objectContaining({ body: expect.stringContaining('192.0.2.20') }));
});

it('rejects a missing proxy client address before contacting the agent', async () => {
  await expect(bindDevice(request(''), scope, user))
    .rejects.toBeInstanceOf(PortalBindingError);
  expect(global.fetch).not.toHaveBeenCalled();
});
