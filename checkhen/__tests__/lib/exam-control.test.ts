import { createHmac } from 'node:crypto';
import { examAgent, examDomains } from '@/lib/exam-control';

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
