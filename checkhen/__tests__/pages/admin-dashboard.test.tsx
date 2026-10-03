import { render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '../../theme';
import AdminDashboard from '@/pages/admin/dashboard';
import { getSocket } from '@/lib/socket';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn() }));
jest.mock('@/components/Admin/StudentProfileModal', () => ({
  StudentProfileModal: () => null,
}));

it('connects on first load after the user and current class arrive, then disconnects on unmount', async () => {
  const socket = { on: jest.fn(), off: jest.fn(), disconnect: jest.fn() };
  (getSocket as jest.Mock).mockReturnValue(socket);
  global.fetch = jest.fn(async (url) => {
    let data: unknown = { message: '[]' };
    if (url === '/api/get-user-info') {
      data = { user: { id: 'instructor', emailAddresses: [{ emailAddress: 'instructor@example.edu' }] } };
    } else if (url === '/api/fetch-latest-class') {
      data = { message: JSON.stringify({ id: 'session-1', name: 'Class', createdAt: new Date(), duration: 60 }) };
    } else if (url === '/api/admin/class-templates') {
      data = [];
    } else if (String(url).includes('pace')) {
      data = { slowDown: 0, readyToMove: 0 };
    }
    return { ok: true, json: async () => data } as Response;
  });
  const view = render(<MantineProvider theme={theme}><AdminDashboard /></MantineProvider>);
  await waitFor(() => expect(getSocket).toHaveBeenCalledWith('session-1'));
  expect(getSocket).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
});
