import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StudentProfileModal } from '@/components/Admin/StudentProfileModal';
import { getSocket } from '@/lib/socket';
import AdminDashboard from '@/pages/admin/dashboard';
import { theme } from '../../theme';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn() }));
jest.mock('@/components/Admin/StudentProfileModal', () => ({
  StudentProfileModal: jest.fn(() => null),
}));

it('connects on first load after the user and current class arrive, then disconnects on unmount', async () => {
  const socket = { on: jest.fn(), off: jest.fn(), disconnect: jest.fn() };
  (getSocket as jest.Mock).mockReturnValue(socket);
  global.fetch = jest.fn(async (url) => {
    let data: unknown = { message: '[]' };
    if (url === '/api/get-user-info') {
      data = {
        user: { id: 'instructor', emailAddresses: [{ emailAddress: 'instructor@example.edu' }] },
      };
    } else if (url === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-1',
          name: 'Class',
          createdAt: new Date(),
          duration: 60,
        }),
      };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (String(url).includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const view = render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  await waitFor(() => expect(getSocket).toHaveBeenCalledWith('session-1'));
  expect(getSocket).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
});

it('starts an exam only after the instructor confirms the allowlist and threshold', async () => {
  const socket = { on: jest.fn(), off: jest.fn(), disconnect: jest.fn() };
  (getSocket as jest.Mock).mockReturnValue(socket);
  const examPosts: Record<string, unknown>[] = [];
  global.fetch = jest.fn(async (input, init?: RequestInit) => {
    // Earlier tests leave a scope in sessionStorage, so match on the path alone.
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (url === '/api/get-user-info') {
      data = {
        user: { id: 'instructor', emailAddresses: [{ emailAddress: 'instructor@example.edu' }] },
      };
    } else if (url === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-1',
          name: 'Class',
          createdAt: new Date(),
          duration: 60,
        }),
      };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (String(url).includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    } else if (url === '/api/admin/exam') {
      if (init?.method === 'POST') {
        examPosts.push(JSON.parse(String(init.body)));
      }
      data = { exam: null, fails: [], network: { active: false, clients: [] }, students: [] };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const confirm = jest.spyOn(window, 'confirm');
  const view = render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  fireEvent.change(await screen.findByLabelText('Allowed domains'), {
    target: { value: 'exam.example.edu' },
  });
  // Declining the confirmation sends nothing.
  confirm.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Start exam' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('exam.example.edu'));
  expect(confirm.mock.calls[0][0]).toContain('30 seconds');
  expect(examPosts).toEqual([]);
  confirm.mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start exam' }));
  await waitFor(() =>
    expect(examPosts).toEqual([
      { action: 'start', domains: ['exam.example.edu'], thresholdSeconds: 30 },
    ])
  );
  confirm.mockRestore();
  view.unmount();
});

it('keeps fails from an ended exam listed and excusable', async () => {
  const socket = { on: jest.fn(), off: jest.fn(), disconnect: jest.fn() };
  (getSocket as jest.Mock).mockReturnValue(socket);
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (url === '/api/get-user-info') {
      data = {
        user: { id: 'instructor', emailAddresses: [{ emailAddress: 'instructor@example.edu' }] },
      };
    } else if (url === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-1',
          name: 'Class',
          createdAt: new Date(),
          duration: 60,
        }),
      };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (url.includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    } else if (url === '/api/admin/exam') {
      data = {
        exam: { id: 'exam-1', domains: ['exam.example.edu'], thresholdSeconds: 30, active: false },
        fails: [
          { id: 'fail-1', userId: 'student', examId: 'exam-1', excused: false, reason: null },
        ],
        network: { active: false, clients: [] },
        students: [{ userId: 'student', name: 'Alisha Moreno' }],
      };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const view = render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  expect(await screen.findByText('Exam fails')).toBeInTheDocument();
  expect(screen.getByText('Alisha Moreno')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Excuse Alisha Moreno' })).toBeInTheDocument();
  view.unmount();
});

it('warns when the access point stops checking connections during an exam', async () => {
  const socket = { on: jest.fn(), off: jest.fn(), disconnect: jest.fn() };
  (getSocket as jest.Mock).mockReturnValue(socket);
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (url === '/api/get-user-info') {
      data = {
        user: { id: 'instructor', emailAddresses: [{ emailAddress: 'instructor@example.edu' }] },
      };
    } else if (url === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-1',
          name: 'Class',
          createdAt: new Date(),
          duration: 60,
        }),
      };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (url.includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    } else if (url === '/api/admin/exam') {
      data = {
        exam: { id: 'exam-1', domains: ['exam.example.edu'], thresholdSeconds: 30, active: true },
        fails: [],
        network: { active: true, clients: [], monitor: { healthy: false, error: 'OSError' } },
        students: [],
      };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const view = render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  expect(await screen.findByText('Connection checks have stopped')).toBeInTheDocument();
  view.unmount();
});

it('counts two open fails as failed, not excused', async () => {
  const socket = { on: jest.fn(), off: jest.fn(), disconnect: jest.fn() };
  (getSocket as jest.Mock).mockReturnValue(socket);
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (url === '/api/get-user-info') {
      data = {
        user: { id: 'instructor', emailAddresses: [{ emailAddress: 'instructor@example.edu' }] },
      };
    } else if (url === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-1',
          name: 'Class',
          createdAt: new Date(),
          duration: 60,
        }),
      };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (url.includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    } else if (url === '/api/admin/exam') {
      data = {
        exam: { id: 'exam-1', domains: ['exam.example.edu'], thresholdSeconds: 30, active: true },
        fails: [
          { id: 'fail-1', userId: 'student', examId: 'exam-1', excused: false, reason: null },
          { id: 'fail-2', userId: 'student', examId: 'exam-1', excused: false, reason: null },
        ],
        network: {
          active: true,
          clients: [{ userId: 'student', connected: true, disconnectedAt: null, failed: true }],
        },
        students: [{ userId: 'student', name: 'Alisha Moreno' }],
      };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const view = render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  expect(await screen.findByText('Failed ×2')).toBeInTheDocument();
  expect(screen.queryByText('Excused')).not.toBeInTheDocument();
  view.unmount();
});

it('keeps dashboard moderation and author profiles usable through newest-first chat refreshes', async () => {
  const handlers: Record<string, () => void> = {};
  (getSocket as jest.Mock).mockReturnValue({
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: jest.fn(),
    disconnect: jest.fn(),
  });
  const makeMessage = (id: string, hour: number) => ({
    id,
    userId: `user-${id}`,
    hidden: false,
    hideEventId: null,
    message: `Message ${id}`,
    anonymousName: 'Blue Hen',
    createdAt: `2026-10-29T${hour}:00:00Z`,
    user: {
      email: `${id}@example.edu`,
      name: `Canonical ${id}`,
      displayName: `Author ${id}`,
      pronouns: 'they/them',
      namePronunciation: null,
    },
  });
  let messages = [makeMessage('old', 12), makeMessage('new', 14), makeMessage('middle', 13)];
  const posts: { url: string; body: unknown }[] = [];
  global.fetch = jest.fn(async (input, init?: RequestInit) => {
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ url, body });
      if (url === '/api/admin/hide-chat' || url === '/api/admin/unhide-chat') {
        messages = messages.map((msg) =>
          msg.id === body.messageId ? { ...msg, hidden: url === '/api/admin/hide-chat' } : msg
        );
      }
    }
    if (url === '/api/get-user-info') {
      data = { user: { id: 'instructor', emailAddresses: [] } };
    } else if (url === '/api/fetch-latest-class') {
      data = {
        message: JSON.stringify({
          id: 'session-chat',
          name: 'Class',
          createdAt: new Date(),
          duration: 60,
        }),
      };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (url.includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    } else if (url === '/api/admin/fetch-all-chat') {
      data = { message: JSON.stringify(messages) };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const view = render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  await screen.findByText('Message new');
  const region = screen.getByRole('region', { name: 'Discussion messages' });
  const order = () =>
    Array.from(region.querySelectorAll('[data-message-id]')).map((node) =>
      node.getAttribute('data-message-id')
    );
  expect(order()).toEqual(['new', 'middle', 'old']);
  messages = [messages[2], messages[0], messages[1]];
  await act(async () => {
    handlers['fetch-messages']();
  });
  expect(order()).toEqual(['new', 'middle', 'old']);
  const newest = within(region.querySelector('[data-message-id="new"]') as HTMLElement);
  fireEvent.click(newest.getByText(/Author new/));
  expect(StudentProfileModal).toHaveBeenLastCalledWith(
    expect.objectContaining({ email: 'new@example.edu' }),
    undefined
  );
  fireEvent.click(newest.getByRole('button', { name: 'Hide' }));
  await newest.findByRole('button', { name: 'Unhide' });
  expect(newest.getByText('Hidden')).toBeInTheDocument();
  fireEvent.click(newest.getByRole('button', { name: 'Unhide' }));
  await newest.findByRole('button', { name: 'Hide' });
  fireEvent.click(newest.getByRole('button', { name: 'Mute student' }));
  await waitFor(() =>
    expect(posts).toEqual([
      { url: '/api/admin/hide-chat', body: { messageId: 'new' } },
      { url: '/api/admin/unhide-chat', body: { messageId: 'new' } },
      { url: '/api/admin/mute-student', body: { userId: 'user-new' } },
    ])
  );
  view.unmount();
});
