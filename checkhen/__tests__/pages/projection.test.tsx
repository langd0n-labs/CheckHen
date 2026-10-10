import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { io } from 'socket.io-client';
import ProjectionPage from '@/pages/projection';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { ticket: 'signed-ticket' } }) }));
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

it('renders anonymous chat and removes a hidden message on the socket update', async () => {
  let refresh = () => {};
  (io as jest.Mock).mockReturnValue({ on: (_event: string, callback: () => void) => { refresh = callback; },
    disconnect: jest.fn() });
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{
      id: 'message', message: 'Question?', anonymousName: 'Swift Panda',
      createdAt: '2026-10-04', user: { email: 'student@example.edu' },
    }] }) })
    .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });
  global.fetch = fetchMock;
  render(<MantineProvider><ProjectionPage /></MantineProvider>);
  expect(await screen.findByText('Question?')).toBeInTheDocument();
  expect(screen.getByText('Swift Panda')).toBeInTheDocument();
  expect(screen.queryByText('student@example.edu')).not.toBeInTheDocument();
  refresh();
  await waitFor(() => expect(screen.queryByText('Question?')).not.toBeInTheDocument());
});
