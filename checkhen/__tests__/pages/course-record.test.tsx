import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DEFAULT_CONFIG } from '@/lib/cold-call';
import CourseRecord from '@/pages/admin/course';
import { theme } from '../../theme';

const payload = {
  course: { id: 'course-1', name: 'Data Science 100' },
  config: { ...DEFAULT_CONFIG, term_meetings: 26 },
  defaults: DEFAULT_CONFIG,
  report: {
    sessionsHeld: 4,
    A: 3,
    students: [
      {
        userId: 'ada',
        name: 'Ada',
        email: 'ada@example.edu',
        sessionsAttended: 3,
        sessionsHeld: 4,
        handRaises: 2,
        volunteerAnswers: 3,
        answers: 2,
        passes: 1,
        absences: 1,
        excusedAbsences: 1,
        opportunities: 4,
        projectedAnswers: 13,
        A: 3,
        volunteerCap: 2,
        score: 1,
        examFails: 1,
        examFailsExcused: 1,
      },
    ],
    sessions: [
      {
        classId: 'm1',
        name: 'Week 1',
        startedAt: '2026-09-01T14:00:00Z',
        checkedIn: 30,
        questions: 6,
        excusedAbsences: 3,
        answers: 4,
        absences: 1,
        volunteerAnswers: 2,
        examFails: 0,
      },
    ],
    absences: [
      {
        callId: 'call-9',
        classId: 'm1',
        sessionName: 'Week 1',
        startedAt: '2026-09-01T14:00:00Z',
        userId: 'ada',
        name: 'Ada',
        excused: false,
        reason: null,
      },
      {
        callId: 'call-10',
        classId: 'm1',
        sessionName: 'Week 1',
        startedAt: '2026-09-01T14:00:00Z',
        userId: 'ada',
        name: 'Ada',
        excused: true,
        reason: 'Nurse visit',
      },
    ],
  },
};

let posted: Record<string, unknown>[] = [];
beforeEach(() => {
  posted = [];
  sessionStorage.setItem('checkhen.scope', JSON.stringify({ courseId: 'course-1' }));
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) {
      posted.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    expect(String(url)).toBe('/api/admin/course-report?courseId=course-1');
    return { ok: true, json: async () => payload } as Response;
  }) as jest.Mock;
});

const view = () =>
  render(
    <MantineProvider theme={theme}>
      <CourseRecord />
    </MantineProvider>
  );

it('shows the provisional target and each grade component per student', async () => {
  view();
  expect(await screen.findByText(/Target: A = 3 answers this term/)).toBeInTheDocument();
  const row = screen.getByText('ada@example.edu').closest('tr')!;
  expect(within(row).getByText('3 of 4')).toBeInTheDocument();
  expect(within(row).getByText('1 (+1 excused)')).toBeInTheDocument();
  // Three volunteer answers, of which the cap of two count.
  expect(within(row).getByText('3 (2 count)')).toBeInTheDocument();
  expect(within(row).getByText('100%')).toBeInTheDocument();
});

it('links both CSV exports for the course', async () => {
  view();
  expect(await screen.findByRole('link', { name: 'Export students (CSV)' })).toHaveAttribute(
    'href',
    '/api/admin/course-report?courseId=course-1&format=csv&view=students'
  );
  expect(screen.getByRole('link', { name: 'Export sessions (CSV)' })).toHaveAttribute(
    'href',
    '/api/admin/course-report?courseId=course-1&format=csv&view=sessions'
  );
});

it('excuses an absence with a reason', async () => {
  view();
  fireEvent.click(await screen.findByRole('tab', { name: /Absences/ }));
  const button = await screen.findByRole('button', { name: /^Excuse Ada on/ });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Reason to excuse Ada/), {
    target: { value: 'Nurse visit' },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(posted).toEqual([
      {
        courseId: 'course-1',
        action: 'excuse',
        classId: 'm1',
        callId: 'call-9',
        reason: 'Nurse visit',
      },
    ])
  );
});

it('saves settings without offering A as a setting', async () => {
  view();
  fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
  expect(screen.queryByLabelText(/^A$/)).not.toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText('Meetings in the term'), {
    target: { value: '28' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(posted[0]).toMatchObject({
      courseId: 'course-1',
      action: 'config',
      config: expect.objectContaining({ term_meetings: 28, ratio: 0.7 }),
    })
  );
});

it('undoes an excuse', async () => {
  view();
  fireEvent.click(await screen.findByRole('tab', { name: /Absences/ }));
  expect(await screen.findByText('Excused: Nurse visit')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Undo the excuse for Ada on/ }));
  await waitFor(() =>
    expect(posted).toEqual([
      { courseId: 'course-1', action: 'unexcuse', classId: 'm1', callId: 'call-10' },
    ])
  );
});

it('keeps a cleared setting empty and blocks saving until it has a value', async () => {
  view();
  fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
  fireEvent.change(await screen.findByLabelText('Lowest A'), { target: { value: '' } });
  expect(await screen.findByText('Enter a value, or the default 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
});

it('offers a retry when the record cannot load', async () => {
  (global.fetch as jest.Mock).mockImplementationOnce(
    async () => ({ ok: false, json: async () => ({}) }) as Response
  );
  view();
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/Target: A = 3 answers this term/)).toBeInTheDocument();
});

/** Each header with the cell under it, from the first body row of the visible table. */
function columns() {
  const table = screen.getByRole('table');
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
  const cells = within(within(table).getAllByRole('row')[1])
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
  expect(cells).toHaveLength(headers.length);
  return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
}

it('puts every value under its own header in both tables', async () => {
  view();
  await screen.findByText(/Target: A = 3/);
  expect(columns()).toMatchObject({
    Attended: '3 of 4',
    Answers: '2',
    Passes: '1',
    Absences: '1 (+1 excused)',
    Volunteered: '3 (2 count)',
    Opportunities: '4',
    Score: '100%',
    'Exam fails': '1 (1 excused)',
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
  await waitFor(() =>
    expect(columns()).toMatchObject({
      Session: 'Week 1',
      'Checked in': '30',
      'Questions asked': '6',
      Answers: '4',
      Volunteered: '2',
      Absences: '1',
      Excused: '3',
      'Exam fails': '0',
    })
  );
});

it('says when saved settings could not be used', async () => {
  (global.fetch as jest.Mock).mockImplementationOnce(
    async () =>
      ({
        ok: true,
        json: async () => ({
          ...payload,
          configProblem: 'The lowest and highest A must be whole numbers of at least 1',
        }),
      }) as Response
  );
  view();
  expect(await screen.findByText('Saved settings could not be used')).toBeInTheDocument();
  expect(screen.getByText(/The default settings are in force/)).toBeInTheDocument();
});
