import { createMocks } from 'node-mocks-http';
import {
  CHATTER_LINES,
  CHATTER_MAX_MS,
  chatterStatus,
  postChatter,
  startChatter,
  stopChatter,
} from '@/lib/demo-chatter';
import { databaseFull } from '@/lib/demo-guard';
import { appendEvent, readState } from '@/lib/event-store';
import { requireScope } from '@/lib/request-scope';
import chatterRoute from '@/pages/api/demo/chatter';

jest.mock('@/lib/event-store', () => ({ appendEvent: jest.fn(), readState: jest.fn() }));
jest.mock('@/lib/demo-guard', () => ({ databaseFull: jest.fn() }));
jest.mock('@/lib/request-scope', () => ({ requireScope: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const scope = { courseId: 'course', classId: 'class' };
const db = {} as any;
const present = (userId: string, anonymousName: string, isPresent = true) => ({
  userId,
  anonymousName,
  isPresent,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (databaseFull as jest.Mock).mockResolvedValue(false);
  (appendEvent as jest.Mock).mockResolvedValue({ id: 'event' });
  (readState as jest.Mock).mockResolvedValue({
    endedAt: null,
    mutedUsers: ['muted'],
    attendance: [
      present('a', 'Swift Panda'),
      present('gone', 'Calm Fox', false),
      present('muted', 'Bold Otter'),
    ],
  });
});

afterEach(() => {
  stopChatter(scope);
  jest.useRealTimers();
});

it('posts as a checked-in, unmuted student under their anonymous name', async () => {
  expect(await postChatter(db, scope, 'breed is categorical')).toBe(true);
  expect(appendEvent).toHaveBeenCalledWith(db, {
    ...scope,
    actorId: 'a',
    userId: 'a',
    kind: 'CHAT_MESSAGE',
    payload: { message: 'breed is categorical', anonymousName: 'Swift Panda' },
  });
});

it('stops when no one can speak or the session has ended', async () => {
  (readState as jest.Mock).mockResolvedValueOnce({ endedAt: null, mutedUsers: [], attendance: [] });
  expect(await postChatter(db, scope, 'hi')).toBe(false);
  (readState as jest.Mock).mockResolvedValueOnce({
    endedAt: new Date(),
    mutedUsers: [],
    attendance: [present('a', 'Swift Panda')],
  });
  expect(await postChatter(db, scope, 'hi')).toBe(false);
  expect(appendEvent).not.toHaveBeenCalled();
});

it('posts every few seconds until stopped', async () => {
  startChatter(db, scope);
  expect(chatterStatus(scope).running).toBe(true);
  await jest.advanceTimersByTimeAsync(30_000);
  const posted = (appendEvent as jest.Mock).mock.calls.length;
  expect(posted).toBeGreaterThanOrEqual(5);
  expect(posted).toBeLessThanOrEqual(15);
  for (const [, input] of (appendEvent as jest.Mock).mock.calls) {
    expect(CHATTER_LINES).toContain(input.payload.message);
  }
  stopChatter(scope);
  await jest.advanceTimersByTimeAsync(30_000);
  expect((appendEvent as jest.Mock).mock.calls.length).toBe(posted);
  expect(chatterStatus(scope).running).toBe(false);
});

it('stops on its own after ten minutes, or when the demo database is full', async () => {
  startChatter(db, scope);
  await jest.advanceTimersByTimeAsync(CHATTER_MAX_MS + 10_000);
  expect(chatterStatus(scope).running).toBe(false);
  startChatter(db, scope);
  (databaseFull as jest.Mock).mockResolvedValue(true);
  (appendEvent as jest.Mock).mockClear();
  await jest.advanceTimersByTimeAsync(10_000);
  expect(appendEvent).not.toHaveBeenCalled();
  expect(chatterStatus(scope).running).toBe(false);
});

describe('the route', () => {
  afterEach(() => {
    delete process.env.CHECKHEN_DEMO;
    delete process.env.CHECKHEN_MODE;
  });
  const invoke = async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
    const { req, res } = createMocks({ method, body, query: scope });
    await chatterRoute(req as any, res as any);
    return res;
  };

  it('exists only in demo mode', async () => {
    expect((await invoke('POST', { action: 'start' }))._getStatusCode()).toBe(404);
    expect(chatterStatus(scope).running).toBe(false);
  });

  it('starts and stops for the selected session', async () => {
    process.env.CHECKHEN_DEMO = '1';
    process.env.CHECKHEN_MODE = 'hosted';
    (requireScope as jest.Mock).mockResolvedValue({ scope, user: { id: 'hoot' }, admin: true });
    expect((await invoke('POST', { action: 'start' }))._getJSONData().running).toBe(true);
    expect((await invoke('GET'))._getJSONData().running).toBe(true);
    expect((await invoke('POST', { action: 'stop' }))._getJSONData().running).toBe(false);
    expect(requireScope).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  });
});
