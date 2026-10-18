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

it('clears the chat and stops once its access is refused', async () => {
  let refresh = () => {};
  const disconnect = jest.fn();
  (io as jest.Mock).mockReturnValue({ on: (_event: string, callback: () => void) => { refresh = callback; },
    disconnect });
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [{
      id: 'message', message: 'Question?', anonymousName: 'Swift Panda', createdAt: '2026-10-04',
    }] }) })
    .mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
  render(<MantineProvider><ProjectionPage /></MantineProvider>);
  expect(await screen.findByText('Question?')).toBeInTheDocument();
  refresh();
  expect(await screen.findByText(/Projection access expired/)).toBeInTheDocument();
  expect(screen.queryByText('Question?')).not.toBeInTheDocument();
  expect(disconnect).toHaveBeenCalled();
});

it('keeps the chat and says it is unavailable when the server cannot be reached', async () => {
  let refresh = () => {};
  (io as jest.Mock).mockReturnValue({ on: (_event: string, callback: () => void) => { refresh = callback; },
    disconnect: jest.fn() });
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [{
      id: 'message', message: 'Question?', anonymousName: 'Swift Panda', createdAt: '2026-10-04',
    }] }) })
    .mockRejectedValue(new TypeError('Failed to fetch'));
  render(<MantineProvider><ProjectionPage /></MantineProvider>);
  expect(await screen.findByText('Question?')).toBeInTheDocument();
  refresh();
  expect(await screen.findByText('Chat unavailable')).toBeInTheDocument();
  expect(screen.getByText('Question?')).toBeInTheDocument();
});
