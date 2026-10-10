import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SessionScopePicker } from '@/components/SessionScopePicker';
import { theme } from '../../theme';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { isAdmin: true } } }),
}));

// Its own file: the deployment mode is fetched once per page load and cached.
it('offers no course creation in the demo, which refuses it', async () => {
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    const data =
      url === '/api/mode' ? { mode: 'hosted', demo: true } : { courses: [], sessions: [] };
    return { ok: true, json: async () => data } as Response;
  }) as jest.Mock;
  render(
    <MantineProvider theme={theme}>
      <SessionScopePicker />
    </MantineProvider>
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/mode'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByRole('button', { name: 'Create course' })).not.toBeInTheDocument();
});
