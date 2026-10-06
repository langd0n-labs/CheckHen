import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import InstructorHelp from '@/pages/help/instructor';
import ProjectionHelp from '@/pages/help/projection';
import StudentHelp from '@/pages/help/student';
import { theme } from '../../theme';

const view = (Page: ComponentType) =>
  render(
    <MantineProvider theme={theme}>
      <Page />
    </MantineProvider>
  );

/** Section anchors that the surfaces link to. */
const anchors = () => Array.from(document.querySelectorAll('section')).map((section) => section.id);

it('gives each student topic an anchor and marks exam mode as unfinished', () => {
  view(StudentHelp);
  expect(anchors()).toEqual(['checking-in', 'chat', 'hands-and-pace', 'profile', 'exam-mode']);
  const exam = document.getElementById('exam-mode')!;
  expect(within(exam).getByText(/Do not use it in class yet/)).toBeInTheDocument();
  // The participation-rules section is on hold with the operator.
  expect(screen.queryByText(/opportunit/i)).not.toBeInTheDocument();
});

it('covers the dashboard, cold calling, and exam mode for instructors, not the course record', () => {
  view(InstructorHelp);
  expect(anchors()).toEqual(['dashboard', 'cold-call', 'exam-mode']);
  const coldCall = document.getElementById('cold-call')!;
  expect(within(coldCall).getByText(/A Pass on a follow-up costs nothing/)).toBeInTheDocument();
  expect(
    within(coldCall).getByText(/Undoing an Absent also checks the student back in/)
  ).toBeInTheDocument();
  expect(within(coldCall).getByText(/at a fifth of\s+their usual weight/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Cold calling' })).toHaveAttribute('href', '#cold-call');
});

it('says the room never sees real names or cold-call outcomes', () => {
  view(ProjectionHelp);
  expect(anchors()).toEqual(['projection-window', 'slidev']);
  expect(screen.getByText(/never real names/)).toBeInTheDocument();
  expect(screen.getByText(/Cold-call draws and their outcomes never appear/)).toBeInTheDocument();
});
