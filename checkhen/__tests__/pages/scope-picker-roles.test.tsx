import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SessionScopePicker } from '@/components/SessionScopePicker';
import { theme } from '../../theme';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { isAdmin: true } } }),
}));

const courses = [
  { id: 'a', name: 'Course A', role: 'instructor' },
  { id: 'b', name: 'Course B', role: 'student' },
];

beforeEach(() => {
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    const data =
      url === '/api/mode'
        ? { mode: 'hosted', demo: false }
        : url === '/api/courses'
          ? { courses, canCreate: false }
          : { sessions: [] };
    return { ok: true, json: async () => data } as Response;
  }) as jest.Mock;
});

const view = () =>
  render(
    <MantineProvider theme={theme}>
      <SessionScopePicker />
    </MantineProvider>
  );

it('links a student page to the courses its user instructs', async () => {
  window.history.pushState({}, '', '/');
  view();
  expect(await screen.findByRole('link', { name: 'Courses you instruct' })).toBeInTheDocument();
});

it('links an instructor page to the courses its user takes, and offers no course creation to staff', async () => {
  window.history.pushState({}, '', '/admin/dashboard');
  view();
  expect(await screen.findByRole('link', { name: 'Courses you take' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create course' })).not.toBeInTheDocument();
});
