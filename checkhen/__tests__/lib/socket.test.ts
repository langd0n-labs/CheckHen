import { io } from 'socket.io-client';
import { getSocket } from '@/lib/socket';

jest.mock('socket.io-client', () => ({ io: jest.fn(() => ({})) }));

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.setItem(
    'checkhen.scope',
    JSON.stringify({ courseId: 'course-1', classId: 'session-1' })
  );
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SOCKET_URL;
});

it('connects to the page origin when the socket URL is empty', () => {
  process.env.NEXT_PUBLIC_SOCKET_URL = '';
  getSocket('session-1');
  expect((io as jest.Mock).mock.calls[0][0]).toBeUndefined();
});

it('connects to the development socket port when the socket URL is unset', () => {
  getSocket('session-1');
  expect((io as jest.Mock).mock.calls[0][0]).toBe('http://localhost:6060');
});

it('connects to a configured socket URL', () => {
  process.env.NEXT_PUBLIC_SOCKET_URL = 'https://socket.example.edu';
  getSocket('session-1');
  expect((io as jest.Mock).mock.calls[0][0]).toBe('https://socket.example.edu');
});
