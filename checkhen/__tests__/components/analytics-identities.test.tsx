import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StudentDetailView } from '@/components/Admin/Analytics/StudentDetailView';
import { theme } from '../../theme';

jest.mock('@/components/Admin/StudentProfileModal', () => ({ StudentProfileModal: () => null }));

it.each([false, true])(
  'shows photos and real names without email or chat name (all time: %s)',
  (allTime) => {
    render(
      <MantineProvider theme={theme}>
        <StudentDetailView
          data={{
            allTime,
            students: [
              {
                email: 'student@example.edu',
                name: 'Student Name',
                displayName: 'Nickname',
                profilePicture: 'https://example.com/photo.jpg',
                anonymousName: 'Blue Hen',
                checkInTime: '2026-11-05T12:00:00Z',
                checkOutTime: null,
                durationMinutes: null,
                handRaiseCount: 0,
                paceSignal: null,
                engagementScore: null,
              },
            ],
            paceAggregate: { slow_down: 0, ready_to_move_on: 0 },
            selectedClass: null,
          }}
          accentColor="blue"
        />
      </MantineProvider>
    );
    expect(screen.getByText('Student Name (Nickname)')).toBeInTheDocument();
    expect(document.querySelector('img[src="https://example.com/photo.jpg"]')).toBeInTheDocument();
    expect(screen.queryByText('student@example.edu')).not.toBeInTheDocument();
    expect(screen.queryByText('Blue Hen')).not.toBeInTheDocument();
  }
);

it('shows photos and names in the attendance timeline without chat names', () => {
  const { AggregatedView } = require('@/components/Admin/Analytics/AggregatedView');
  render(
    <MantineProvider theme={theme}>
      <AggregatedView
        aggregated={{
          totalStudents: 1,
          avgDurationMinutes: 20,
          absentMoreThan50Percent: 0,
          avgMessagesPerStudent: 0,
          avgHandRaisesPerStudent: 0,
          paceSignalTimeline: [],
          leaveEvents: [
            {
              name: 'Student Name',
              displayName: 'Nickname',
              anonymousName: 'Blue Hen',
              profilePicture: 'https://example.com/photo.jpg',
              checkInTime: '2026-11-05T12:00:00Z',
              checkOutTime: null,
              durationMinutes: null,
              leftEarly: false,
            },
          ],
        }}
        classDuration={60}
        students={[]}
        accentColor="blue"
      />
    </MantineProvider>
  );
  expect(screen.getByText('Student Name (Nickname)')).toBeInTheDocument();
  expect(document.querySelector('img[src="https://example.com/photo.jpg"]')).toBeInTheDocument();
  expect(screen.queryByText('Blue Hen')).not.toBeInTheDocument();
});
