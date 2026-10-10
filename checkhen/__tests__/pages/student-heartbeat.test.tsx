import { act, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { getSocket } from '@/lib/socket';
import Home from '@/pages/index';
import { theme } from '../../theme';

jest.mock('next/router', () => ({ useRouter: () => ({ query: {}, push: jest.fn() }) }));
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'student@example.edu' } }, status: 'authenticated' }),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn() }));

let examActive = false;
const socket = { on: jest.fn(), off: jest.fn(), emit: jest.fn(), disconnect: jest.fn() };

beforeEach(() => {
  jest.useFakeTimers();
  examActive = false;
  socket.emit.mockClear();
  (getSocket as jest.Mock).mockReturnValue(socket);
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const path = String(url).split('?')[0];
    let data: unknown = {};
    if (path === '/api/get-user-info') {
      data = { user: { id: 'student', email: 'student@example.edu' } };
    } else if (path === '/api/student/startup') {
      data = {
        isCheckedIn: true,
        classId: 'session-1',
        className: 'Class',
        anonymousName: 'Swift Panda',
        handRaised: false,
        paceSignals: { slowDown: 0, readyToMove: 0 },
        messages: [],
      };
    } else if (path === '/api/student/exam-status') {
      data = { exam: examActive ? { domains: ['exam.example.edu'] } : null, fail: null };
    } else if (path === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-1',
          name: 'Class',
          createdAt: new Date().toISOString(),
          duration: 120,
        }),
      };
    } else if (path === '/api/student/fetch-all-chat') {
      data = { message: '[]' };
    } else if (path === '/api/student/fetch-pace-signals') {
      data = { slowDown: 0, readyToMove: 0 };
    }
    return { ok: true, json: async () => data } as Response;
  }) as jest.Mock;
});

afterEach(() => {
  jest.useRealTimers();
});

/** Advance the fake clock in steps, letting fetch promises settle between them. */
async function elapse(ms: number) {
  for (let step = 0; step < ms / 1000; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
  }
}

const heartbeats = () =>
  socket.emit.mock.calls.filter(([event]) => event === 'exam-heartbeat').length;

it('sends no exam heartbeats during an ordinary class, and starts when an exam does', async () => {
  render(
    <MantineProvider theme={theme}>
      <Home />
    </MantineProvider>
  );
  // A checked-in student in an ordinary class, for well past several heartbeat intervals.
  await elapse(30000);
  expect(getSocket).toHaveBeenCalledWith('session-1');
  expect(heartbeats()).toBe(0);
  // The instructor starts an exam: the next exam-status poll turns heartbeats on.
  examActive = true;
  await elapse(20000);
  expect(heartbeats()).toBeGreaterThan(0);
});
