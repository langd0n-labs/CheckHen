import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ColdCall from '@/pages/admin/call';
import { theme } from '../../theme';

type Posted = Record<string, unknown>;

function mockServer() {
  const posted: Posted[] = [];
  let calls: unknown[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Posted) : null;
    let data: unknown = { present: 3, calls };
    if (body) {
      posted.push(body);
      if (body.action === 'draw') {
        data = {
          seed: 42,
          eligible: 3,
          student: {
            userId: 'student-1',
            name: 'Alisha Moreno',
            pronunciation: 'ale-EE-sha',
            pronouns: 'she/her',
            photo: null,
          },
        };
      }
      if (body.action === 'record') {
        calls = [
          { id: 'call-1', userId: 'student-1', name: 'Alisha Moreno', outcome: body.outcome },
        ];
        data = { id: 'call-1' };
      }
      if (body.action === 'undo') {
        calls = [];
        data = { ok: true };
      }
    }
    expect(String(url)).toContain('classId=session-1');
    return { ok: true, json: async () => data } as Response;
  }) as jest.Mock;
  return posted;
}

beforeEach(() => {
  sessionStorage.setItem(
    'checkhen.scope',
    JSON.stringify({ courseId: 'course-1', classId: 'session-1' })
  );
});

it('completes Call to Answered in two taps and shows name and pronunciation', async () => {
  const posted = mockServer();
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Call on someone' }));
  expect(await screen.findByText('Alisha Moreno')).toBeInTheDocument();
  expect(screen.getByText('ale-EE-sha')).toBeInTheDocument();
  expect(screen.getByText('she/her')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Answered' }));
  await waitFor(() =>
    expect(posted).toEqual([
      { action: 'draw' },
      { action: 'record', userId: 'student-1', outcome: 'answered', seed: 42 },
    ])
  );
  // No dialog: the screen returns to the call button with the result and an undo.
  expect(await screen.findByText('Alisha Moreno: Answered')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Call on someone' })).toBeInTheDocument();
});

it('undoes the last call immediately', async () => {
  const posted = mockServer();
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Call on someone' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pass' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(posted.at(-1)).toEqual({ action: 'undo', eventId: 'call-1' }));
  expect(await screen.findByText('No one called yet this session.')).toBeInTheDocument();
});
