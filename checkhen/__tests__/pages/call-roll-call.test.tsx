import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ColdCall from '@/pages/admin/call';
import { theme } from '../../theme';

// Its own file: the deployment mode is fetched once per page load and cached.
beforeEach(() => {
  sessionStorage.setItem(
    'checkhen.scope',
    JSON.stringify({ courseId: 'course-1', classId: 'session-1' })
  );
});

it('opens straight into roll call from the dashboard in hosted mode', async () => {
  window.history.pushState({}, '', '/admin/call?roll-call');
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('/api/mode')) {
      return { ok: true, json: async () => ({ mode: 'hosted', demo: false }) } as Response;
    }
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const data =
      body?.action === 'roll-call'
        ? {
            students: [
              { userId: 'a', name: 'Ada', pronunciation: null, photo: null, present: false },
            ],
          }
        : { present: 0, calls: [] };
    return { ok: true, json: async () => data } as Response;
  }) as jest.Mock;
  render(
    <MantineProvider theme={theme}>
      <ColdCall />
    </MantineProvider>
  );
  expect(await screen.findByText('Student 1 of 1')).toBeInTheDocument();
  window.history.pushState({}, '', '/');
});
