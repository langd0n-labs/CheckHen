import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import DemoSignIn from '@/pages/demo';
import { theme } from '../../theme';

jest.mock('next-auth/react', () => ({ signIn: jest.fn() }));

it('suggests a separate browser sign-in for each person in the class', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      courseId: 'course-a',
      liveClassId: 'session-a',
      personas: [
        { email: 'instructor@x', name: 'Professor Hoot', note: '', photo: '', role: 'instructor' },
        { email: 'clover@x', name: 'Clover the Cow', note: '', photo: '', role: 'student' },
      ],
    }),
  })) as jest.Mock;
  render(
    <MantineProvider theme={theme}>
      <DemoSignIn />
    </MantineProvider>
  );
  expect(await screen.findByText(/private window or another browser/)).toBeInTheDocument();
  expect(screen.getByText(/private windows share another/)).toBeInTheDocument();
});
