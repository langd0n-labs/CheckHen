import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StudentCheck } from '@/components/StudentCheck';
import { UnderstandingCheck } from '@/components/UnderstandingCheck';
import { theme } from '../../theme';

const view = (node: React.ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <Notifications />
      {node}
    </MantineProvider>
  );

let posted: { url: string; body: Record<string, unknown> }[] = [];
const respond = (routes: Record<string, unknown>) => {
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    if (init?.method === 'POST') {
      posted.push({ url: path, body: JSON.parse(String(init.body)) });
      return { ok: true, json: async () => ({}) } as Response;
    }
    return { ok: true, json: async () => routes[path] } as Response;
  }) as jest.Mock;
};
beforeEach(() => {
  posted = [];
  sessionStorage.setItem('checkhen.scope', JSON.stringify({ courseId: 'c', classId: 's' }));
});

const now = new Date().toISOString();
const inThree = new Date(Date.now() + 180_000).toISOString();

describe('the student card', () => {
  it('stays hidden while no check is open', async () => {
    respond({ '/api/student/fetch-check': { now, check: null } });
    view(<StudentCheck enabled />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Did that land?')).not.toBeInTheDocument();
  });

  it('shows the label, countdown and both answers, and sends the chosen one', async () => {
    respond({
      '/api/student/fetch-check': {
        now,
        check: {
          checkId: 'k',
          label: 'Sampling',
          choices: ['got_it', 'another_example'],
          closesAt: inThree,
          answer: null,
        },
      },
    });
    view(<StudentCheck enabled />);
    expect(await screen.findByText('Did that land?')).toBeInTheDocument();
    expect(screen.getByText('Sampling')).toBeInTheDocument();
    expect(screen.getByText(/^[23]:\d\d left$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Another example' }));
    await screen.findByText(/Sent to your instructor/);
    expect(posted).toEqual([
      { url: '/api/student/answer-check', body: { checkId: 'k', choice: 'another_example' } },
    ]);
    expect(screen.getByRole('button', { name: 'Another example' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});

describe("the instructor's check", () => {
  const open = (another: number, gotIt: number) => ({
    now,
    threshold: 0.25,
    check: {
      checkId: 'k',
      label: null,
      choices: ['got_it', 'another_example'],
      openedAt: now,
      closesAt: null,
      closedAt: null,
      open: true,
      present: 12,
      answered: another + gotIt,
      counts: { got_it: gotIt, another_example: another },
      answers: [
        ...Array.from({ length: gotIt }, (_, i) => ({
          userId: `g${i}`,
          name: `Got${i}`,
          choice: 'got_it',
        })),
        ...Array.from({ length: another }, (_, i) => ({
          userId: `a${i}`,
          name: `Again${i}`,
          choice: 'another_example',
        })),
      ],
      number: 2,
    },
  });

  it('opens a 3-minute check with an optional label', async () => {
    respond({ '/api/admin/fetch-check': { now, threshold: 0.25, check: null } });
    view(<UnderstandingCheck />);
    fireEvent.change(await screen.findByPlaceholderText('Label (optional)'), {
      target: { value: 'Sampling' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check understanding' }));
    await waitFor(() =>
      expect(posted).toEqual([
        { url: '/api/admin/open-check', body: { label: 'Sampling', minutes: 3 } },
      ])
    );
  });

  it('shows answered of present, the split and who chose what', async () => {
    respond({ '/api/admin/fetch-check': open(1, 3) });
    view(<UnderstandingCheck />);
    expect(await screen.findByText('4 of 12 answered')).toBeInTheDocument();
    expect(screen.getByText('No timer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show who answered'));
    expect(screen.getByText(/Again0/)).toBeInTheDocument();
    expect(screen.getByText('25% asked for another example.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close check' }));
    await waitFor(() =>
      expect(posted).toEqual([{ url: '/api/admin/close-check', body: { checkId: 'k' } }])
    );
  });

  it('waits for three answers before the another-example notice', async () => {
    respond({ '/api/admin/fetch-check': open(1, 0) });
    view(<UnderstandingCheck />);
    expect(await screen.findByText('1 of 12 answered')).toBeInTheDocument();
    expect(screen.queryByText(/asked for another example/)).not.toBeInTheDocument();
  });
});


describe.each(['student', 'instructor'])('%s refresh reliability', (audience) => {
  const data = (label: string) => ({
    now: new Date().toISOString(), threshold: 0.25,
    check: {
      checkId: 'k', label, choices: ['got_it', 'another_example'],
      closesAt: null, answer: null, openedAt: now, closedAt: null,
      open: true, present: 5, answered: 0, counts: {}, answers: [], number: 1,
    },
  });
  const component = (signal: number) => audience === 'student'
    ? <StudentCheck enabled refreshSignal={signal} />
    : <UnderstandingCheck refreshSignal={signal} />;
  const wrapped = (signal: number) => <MantineProvider theme={theme}>{component(signal)}</MantineProvider>;

  it.each(['network', 'http', 'json'])('keeps data after a %s failure and clears the status after recovery', async (failure) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data('Current') });
    const { rerender } = render(wrapped(0));
    await screen.findByText(/Current/);
    if (failure === 'network') (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    if (failure === 'http') (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    if (failure === 'json') (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('invalid JSON'); } });
    rerender(wrapped(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not refresh');
    expect(screen.getByText(/Current/)).toBeInTheDocument();
    rerender(wrapped(2));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it.each([false, true])('ignores an older response (failure: %s) after a newer refresh', async (fails) => {
    let resolveOld!: (value: unknown) => void;
    const oldJson = new Promise((resolve) => { resolveOld = resolve; });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => oldJson })
      .mockResolvedValue({ ok: true, json: async () => data('Newest') });
    const { rerender } = render(wrapped(0));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    rerender(wrapped(1));
    await screen.findByText(/Newest/);
    await act(async () => {
      resolveOld(fails ? Promise.reject(new Error('old failure')) : data('Old'));
    });
    expect(screen.getByText(/Newest/)).toBeInTheDocument();
    expect(screen.queryByText(/Old/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
