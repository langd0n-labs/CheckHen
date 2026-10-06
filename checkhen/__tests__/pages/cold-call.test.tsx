import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import ColdCall from '@/pages/admin/call';
import { theme } from '../../theme';

type Posted = Record<string, unknown>;

function mockServer(fail: { record?: number; status?: boolean } = {}) {
  const posted: Posted[] = [];
  let calls: unknown[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Posted) : null;
    if (!body && fail.status) {
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }
    if (body?.action === 'record' && fail.record) {
      posted.push(body);
      return {
        ok: false,
        status: fail.record,
        json: async () => ({ message: 'A newer draw replaced this one' }),
      } as Response;
    }
    let data: unknown = { present: 3, calls };
    if (body) {
      posted.push(body);
      if (body.action === 'draw') {
        data = {
          seed: 42,
          draw: 'signed-draw',
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
        const id = `call-${posted.length}`;
        calls = [{ id, userId: 'student-1', name: 'Alisha Moreno', outcome: body.outcome }];
        data = {
          id,
          followUp: body.outcome === 'answered' ? `follow-up-${posted.length}` : undefined,
        };
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
      { action: 'record', outcome: 'answered', draw: 'signed-draw' },
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
  await waitFor(() => expect(posted.at(-1)).toEqual({ action: 'undo', eventId: 'call-2' }));
  expect(await screen.findByText('No one called yet this session.')).toBeInTheDocument();
});

it('asks a follow-up of the same student without Absent or Skip, then returns to calling', async () => {
  const posted = mockServer();
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Call on someone' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Answered + follow-up' }));
  expect(await screen.findByText('Follow-up 1')).toBeInTheDocument();
  expect(screen.getByText('Alisha Moreno')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Absent' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Skip (out of the room)' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Answered + follow-up' }));
  expect(await screen.findByText('Follow-up 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Answered' }));
  await waitFor(() =>
    expect(posted.slice(1)).toEqual([
      { action: 'record', outcome: 'answered', draw: 'signed-draw', next: 'follow-up' },
      { action: 'record', outcome: 'answered', followUp: 'follow-up-2', next: 'follow-up' },
      { action: 'record', outcome: 'answered', followUp: 'follow-up-3' },
    ])
  );
  expect(await screen.findByRole('button', { name: 'Call on someone' })).toBeInTheDocument();
});

it('leaves follow-ups with Done and records a skip with one tap', async () => {
  const posted = mockServer();
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Call on someone' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Answered + follow-up' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Done with follow-ups' }));
  expect(await screen.findByRole('button', { name: 'Call on someone' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Call on someone' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Skip (out of the room)' }));
  await waitFor(() =>
    expect(posted.at(-1)).toEqual({ action: 'record', outcome: 'skip', draw: 'signed-draw' })
  );
});

it.each([409, 400])(
  'clears the card and explains when a record is refused (%i)',
  async (status) => {
    const show = jest.spyOn(notifications, 'show');
    mockServer({ record: status });
    render(
      <MantineProvider theme={theme}>
        <ColdCall />
      </MantineProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Call on someone' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Answered' }));
    // The stale card is gone, so the next tap draws again instead of failing again.
    expect(await screen.findByRole('button', { name: 'Call on someone' })).toBeInTheDocument();
    expect(screen.queryByText('Alisha Moreno')).not.toBeInTheDocument();
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'A newer draw replaced this one' })
    );
    show.mockRestore();
  }
);

it('says so when the call list cannot load', async () => {
  const show = jest.spyOn(notifications, 'show');
  mockServer({ status: true });
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  await waitFor(() =>
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Could not load') })
    )
  );
  show.mockRestore();
});

it('starts a follow-up after a plain Answered, and undoes a follow-up from the run', async () => {
  const posted = mockServer();
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Call on someone' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Answered' }));
  // A plain Answered tapped by mistake can still lead to a follow-up.
  fireEvent.click(await screen.findByRole('button', { name: 'Ask a follow-up' }));
  expect(await screen.findByText('Follow-up 1')).toBeInTheDocument();
  expect(screen.getByText('Recorded: Answered')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Answered + follow-up' }));
  expect(await screen.findByText('Follow-up 2')).toBeInTheDocument();
  // The run shows what was just recorded, with an Undo.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() =>
    expect(posted.slice(1)).toEqual([
      { action: 'record', outcome: 'answered', draw: 'signed-draw' },
      { action: 'record', outcome: 'answered', followUp: 'follow-up-2', next: 'follow-up' },
      { action: 'undo', eventId: 'call-3' },
    ])
  );
  expect(await screen.findByRole('button', { name: 'Call on someone' })).toBeInTheDocument();
});
