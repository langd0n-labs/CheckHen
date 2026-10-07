import { createHmac } from 'node:crypto';
import { appendEvent, readState } from '@/lib/event-store';
import { examAgent, examDomains, releaseExamNetwork } from '@/lib/exam-control';

jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

describe('exam control', () => {
  it('normalizes and rejects domain entries', () => {
    expect(examDomains(['Exam.Example.edu.', 'exam.example.edu'])).toEqual(['exam.example.edu']);
    expect(() => examDomains(['*.example.edu'])).toThrow();
    expect(() => examDomains([])).toThrow();
  });

  it('signs the exact network request body', async () => {
    process.env.PORTAL_AGENT_URL = 'http://127.0.0.1:7878';
    process.env.PORTAL_CONTROL_SECRET = 'test-secret';
    const original = global.fetch;
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = jest.fn().mockReturnValue(new AbortController().signal);
    const mock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ active: false }) });
    global.fetch = mock;
    try {
      await examAgent('exam-status', { courseId: 'course', classId: 'class' });
      const [url, request] = mock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:7878/exam-status');
      expect(request.headers['X-CheckHen-Signature']).toBe(
        createHmac('sha256', 'test-secret').update(request.body).digest('hex')
      );
      expect(JSON.parse(request.body)).toMatchObject({ courseId: 'course', classId: 'class' });
    } finally {
      global.fetch = original;
      AbortSignal.timeout = timeout;
    }
  });
});

describe('releasing the exam network', () => {
  const scope = { courseId: 'course', classId: 'class' };
  const original = global.fetch;
  const timeout = AbortSignal.timeout;
  beforeEach(() => {
    AbortSignal.timeout = jest.fn().mockReturnValue(new AbortController().signal);
  });
  afterEach(() => {
    global.fetch = original;
    AbortSignal.timeout = timeout;
    delete process.env.PORTAL_AGENT_URL;
  });

  it('records the fails the agent could not deliver', async () => {
    process.env.PORTAL_AGENT_URL = 'http://127.0.0.1:7878';
    process.env.PORTAL_CONTROL_SECRET = 'test-secret';
    (readState as jest.Mock).mockResolvedValue({
      exam: { id: 'exam', active: true },
      attendance: [{ userId: 'student' }],
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        unreported: [
          { examId: 'exam', userId: 'student', failId: 'drop-1' },
          { examId: 'exam', userId: 'student' },
        ],
      }),
    });
    await releaseExamNetwork(scope);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toMatch(/\/exam-stop$/);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        kind: 'EXAM_FAILED',
        userId: 'student',
        payload: { examId: 'exam', failId: 'drop-1' },
      })
    );
  });

  it('does nothing without a network agent', async () => {
    global.fetch = jest.fn();
    await releaseExamNetwork(scope);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
