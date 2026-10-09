import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { RollCall } from '@/components/RollCall';
import { theme } from '../../theme';

const roster = [
  { userId: 'a', name: 'Ada', pronunciation: 'AY-da', photo: null, present: false },
  { userId: 'b', name: 'Ben', pronunciation: null, photo: null, present: false },
];

it('steps through the roster, marking each student, and finishes', async () => {
  const marks: Record<string, unknown>[] = [];
  sessionStorage.setItem('checkhen.scope', JSON.stringify({ courseId: 'c', classId: 's' }));
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.action === 'mark') {
      marks.push(body);
      const index = roster.findIndex((student) => student.userId === body.userId);
      roster[index] = { ...roster[index], present: body.present };
    }
    return { ok: true, json: async () => ({ students: roster }) } as Response;
  }) as jest.Mock;
  render(
    <MantineProvider theme={theme}>
      <RollCall onDone={jest.fn()} />
    </MantineProvider>
  );
  expect(await screen.findByText('Student 1 of 2')).toBeInTheDocument();
  expect(screen.getByText('AY-da')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Present' }));
  expect(await screen.findByText('Student 2 of 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Absent' }));
  expect(await screen.findByText(/Everyone is marked/)).toBeInTheDocument();
  await waitFor(() =>
    expect(marks).toEqual([
      { action: 'mark', userId: 'a', present: true },
      { action: 'mark', userId: 'b', present: false },
    ])
  );
  expect(screen.getByText('Roll call: 1 of 2 present')).toBeInTheDocument();
  // An Absent mark shows as Absent, not as a student no one has asked about yet.
  expect(screen.getByText('Absent', { selector: '.mantine-Badge-label' })).toBeInTheDocument();
  expect(screen.queryByText('Not marked')).not.toBeInTheDocument();
});
