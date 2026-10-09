import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { getSocket } from '@/lib/socket';
import AdminDashboard from '@/pages/admin/dashboard';
import { theme } from '../../theme';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn() }));
jest.mock('@/components/Admin/StudentProfileModal', () => ({ StudentProfileModal: () => null }));

// Its own file: the deployment mode is fetched once per page load and cached.
it('opens the demo lecture with a chat ticket for this session', async () => {
  (getSocket as jest.Mock).mockReturnValue({
    on: jest.fn(),
    off: jest.fn(),
    disconnect: jest.fn(),
  });
  global.fetch = jest.fn(async (input) => {
    const url = String(input).split('?')[0];
    let data: unknown = { message: '[]' };
    if (url === '/api/mode') {
      data = { mode: 'hosted', demo: true };
    } else if (url === '/api/admin/projection-ticket') {
      data = { ticket: 'signed ticket' };
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
  const target = { opener: {}, location: { href: '' }, close: jest.fn() };
  window.open = jest.fn().mockReturnValue(target);
  render(
    <MantineProvider theme={theme}>
      <AdminDashboard />
    </MantineProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open demo lecture' }));
  await waitFor(() => expect(target.location.href).toBe('/deck/?ticket=signed%20ticket'));
  expect(target.opener).toBeNull();
});
