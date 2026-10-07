import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { getSocket } from '@/lib/socket';
import AdminDashboard from '@/pages/admin/dashboard';
import { theme } from '../../theme';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn() }));
jest.mock('@/components/Admin/StudentProfileModal', () => ({ StudentProfileModal: () => null }));

it('explains that exam mode is unavailable in hosted mode', async () => {
  (getSocket as jest.Mock).mockReturnValue({
    on: jest.fn(),
    off: jest.fn(),
    disconnect: jest.fn(),
  });
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (url === '/api/mode') {
      data = { mode: 'hosted' };
    } else if (url === '/api/get-user-info') {
      data = { user: { id: 'instructor', emailAddresses: [{ emailAddress: 'i@example.edu' }] } };
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
    }
    return { ok: true, json: async () => data } as Response;
  });
  render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  expect(await screen.findByText(/not available in hosted mode/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start exam' })).not.toBeInTheDocument();
});
