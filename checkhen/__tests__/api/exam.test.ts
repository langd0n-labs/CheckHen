import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createMocks } from 'node-mocks-http';
import { appendEvent, readState } from '@/lib/event-store';
import { examAgent, releaseExamNetwork } from '@/lib/exam-control';
import { prisma } from '@/lib/prisma';
import { requireScope } from '@/lib/request-scope';
import examRoute from '@/pages/api/admin/exam';
import failedRoute from '@/pages/api/internal/exam-failed';

jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/exam-control', () => ({
  recordExamFail: jest.requireActual('@/lib/exam-control').recordExamFail,
  examDomains: jest.requireActual('@/lib/exam-control').examDomains,
  examAgent: jest.fn(),
  releaseExamNetwork: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: jest.fn() } } }));

const scope = { courseId: 'course', classId: 'class' };
const user = { id: 'instructor' };
const selected = { createdAt: new Date(Date.now() - 1000), duration: 60 };
const attendance = [
  {
    userId: 'student',
    isPresent: true,
    deviceIp: '172.16.77.20',
    devices: [{ ip: '172.16.77.20', mac: '02:00:00:00:00:20' }],
  },
];
const state = { exam: null, examFails: [], attendance, endedAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PORTAL_CONTROL_SECRET = 'test-secret';
  (requireScope as jest.Mock).mockResolvedValue({ scope, user, selected, admin: true });
  (readState as jest.Mock).mockResolvedValue(state);
  (examAgent as jest.Mock).mockResolvedValue({ active: true, clients: [] });
  (releaseExamNetwork as jest.Mock).mockResolvedValue(undefined);
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event' });
  (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
});

const invoke = async (action: string, body: Record<string, unknown> = {}) => {
  const { req, res } = createMocks({ method: 'POST', query: scope, body: { action, ...body } });
  await examRoute(req as any, res as any);
  return res;
};

it('starts with primary AP devices and an allowlist, then records the event', async () => {
  const res = await invoke('start', { domains: ['Exam.Example.edu.'] });
  expect(res._getStatusCode()).toBe(200);
  expect(examAgent).toHaveBeenCalledWith(
    'exam-start',
    expect.objectContaining({
      ...scope,
      domains: ['exam.example.edu'],
      thresholdSeconds: 30,
      clients: [{ userId: 'student', mac: '02:00:00:00:00:20' }],
    })
  );
  expect(appendEvent).toHaveBeenCalledWith(
    prisma,
    expect.objectContaining({ kind: 'EXAM_STARTED' })
  );
});

it('rejects an absent primary device and an invalid domain', async () => {
  (readState as jest.Mock).mockResolvedValueOnce({
    ...state,
    attendance: [{ ...attendance[0], devices: [] }],
  });
  expect((await invoke('start', { domains: ['exam.example.edu'] }))._getStatusCode()).toBe(400);
  expect((await invoke('start', { domains: ['*.example.edu'] }))._getStatusCode()).toBe(400);
  expect(examAgent).not.toHaveBeenCalled();
});

it('excuses a fail by superseding its immutable event', async () => {
  (readState as jest.Mock).mockResolvedValue({
    ...state,
    exam: { id: 'exam', active: true },
    examFails: [{ id: 'fail', userId: 'student', examId: 'exam', excused: false }],
  });
  expect(
    (await invoke('excuse', { failId: 'fail', reason: 'Verified disconnect' }))._getStatusCode()
  ).toBe(200);
  expect(appendEvent).toHaveBeenCalledWith(
    prisma,
    expect.objectContaining({
      kind: 'EXAM_EXCUSED',
      userId: 'student',
      supersedesId: 'fail',
      payload: { examId: 'exam', reason: 'Verified disconnect' },
    })
  );
});

describe('signed fail callback', () => {
  const signed = async (body: Record<string, unknown>, signature?: string) => {
    const raw = JSON.stringify(body);
    const { res } = createMocks();
    const req = Object.assign(Readable.from([Buffer.from(raw)]), {
      method: 'POST',
      headers: {
        'x-checkhen-signature':
          signature ?? createHmac('sha256', 'test-secret').update(raw).digest('hex'),
      },
    });
    await failedRoute(req as any, res as any);
    return res;
  };
  const body = (failId = 'drop-1') => ({
    ...scope,
    userId: 'student',
    examId: 'exam',
    failId,
    timestamp: Date.now(),
  });
  it('rejects forged reports', async () => {
    expect((await signed(body(), 'wrong'))._getStatusCode()).toBe(403);
    expect(appendEvent).not.toHaveBeenCalled();
  });
  it('retries before start is logged, then records one fail', async () => {
    expect((await signed(body()))._getStatusCode()).toBe(503);
    (readState as jest.Mock).mockResolvedValue({ ...state, exam: { id: 'exam', active: true } });
    expect((await signed(body()))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ kind: 'EXAM_FAILED', userId: 'student' })
    );
    (appendEvent as jest.Mock).mockClear();
    // M5 finding 3: after an excused fail, a later drop is a new fail with its own ID.
    (readState as jest.Mock).mockResolvedValue({
      ...state,
      exam: { id: 'exam', active: true },
      examFails: [{ id: 'fail', userId: 'student', examId: 'exam', excused: true }],
    });
    expect((await signed(body('drop-2')))._getStatusCode()).toBe(200);
    expect(appendEvent).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        kind: 'EXAM_FAILED',
        payload: { examId: 'exam', failId: 'drop-2' },
      })
    );
  });
  it('refuses a report without a fail ID', async () => {
    const { failId: _omitted, ...withoutId } = body();
    expect((await signed(withoutId))._getStatusCode()).toBe(403);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});

it('refuses to start or stop an exam in hosted mode', async () => {
  process.env.CHECKHEN_MODE = 'hosted';
  try {
    for (const action of ['start', 'stop']) {
      const res = await invoke(action, { domains: ['exam.example.edu'] });
      expect(res._getStatusCode()).toBe(409);
      expect(res._getJSONData().message).toMatch(/not available in hosted mode/);
    }
    expect(examAgent).not.toHaveBeenCalled();
  } finally {
    delete process.env.CHECKHEN_MODE;
  }
});

it('refuses a disconnect limit under ten seconds', async () => {
  const res = await invoke('start', { domains: ['exam.example.edu'], thresholdSeconds: 9 });
  expect(res._getStatusCode()).toBe(400);
  expect(examAgent).not.toHaveBeenCalled();
});

it('releases the network when a start fails partway', async () => {
  (examAgent as jest.Mock).mockRejectedValueOnce(new Error('timed out'));
  await expect(invoke('start', { domains: ['exam.example.edu'] })).rejects.toThrow('timed out');
  // Once before the start, to clear a stranded exam, and once after the failure.
  expect(releaseExamNetwork).toHaveBeenCalledTimes(2);
  expect(appendEvent).not.toHaveBeenCalled();
});

it('releases the network on stop even when the log shows no exam', async () => {
  const res = await invoke('stop');
  expect(res._getStatusCode()).toBe(200);
  expect(releaseExamNetwork).toHaveBeenCalledWith(scope);
  expect(appendEvent).not.toHaveBeenCalled();
});
