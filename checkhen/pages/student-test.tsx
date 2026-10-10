import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useEffect, useState } from 'react';
import { Button, Container, Stack, Text, Title } from '@mantine/core';

export default function StudentTestPage() {
  const [latestClass, setLatestClass] = useState<any>(null);
  const [checkIn, setCheckIn] = useState<any>(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);

  useEffect(() => {
    fetchLatestClass();
    fetchCheckIn();
  }, []);

  const fetchLatestClass = async () => {
    const response = await fetch('/api/fetch-latest-class');
    const data = await response.json();
    if (response.ok) {
      setLatestClass(JSON.parse(data.message));
    }
  };

  const fetchCheckIn = async () => {
    const response = await fetch('/api/student/fetch-check-in');
    const data = await response.json();
    if (response.ok && data.message !== 'No check in found') {
      setCheckIn(JSON.parse(data.message));
      setIsCheckedIn(true);
    }
  };

  const handleCheckIn = async () => {
    const response = await fetch('/api/student/check-in', {
      method: 'POST',
      body: JSON.stringify({ mood: 3 }),
    });
    if (response.ok) {
      setIsCheckedIn(true);
      fetchCheckIn();
    }
  };

  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Title order={1}>Student Test View</Title>

        <div>
          <Title order={2}>Current Class</Title>
          {latestClass ? (
            <Text>
              {latestClass.name} - Started at {new Date(latestClass.createdAt).toLocaleString()}
            </Text>
          ) : (
            <Text c="dimmed">No active class</Text>
          )}
        </div>

        <div>
          <Title order={2}>Check-In Status</Title>
          {isCheckedIn ? (
            <Text c="green">You are checked in! Mood: {checkIn?.mood || 'N/A'}</Text>
          ) : (
            <Stack gap="md">
              <Text c="red">You are not checked in</Text>
              <Button onClick={handleCheckIn} disabled={!latestClass}>
                Check In to Class
              </Button>
            </Stack>
          )}
        </div>

        <div>
          <Text size="sm" c="dimmed">
            This is a test page to simulate the student view without needing a second @bu.edu account.
            Go to <a href="/">/</a> to see the actual student interface.
          </Text>
        </div>
      </Stack>
    </Container>
  );
}
