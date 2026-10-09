import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { scopedFetch } from '@/lib/scoped-fetch';

type RosterStudent = {
  userId: string;
  name: string;
  pronunciation: string | null;
  photo: string | null;
  present: boolean;
};

const post = (body: Record<string, unknown>) =>
  scopedFetch('/api/admin/cold-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);

const notify = (message: string) =>
  notifications.show({ message, color: 'red', position: 'top-center' });

/**
 * Hosted-mode attendance: step through the roster and answer "Present?" for each
 * student. A mark writes the same check-in or check-out events as network attendance.
 */
export function RollCall({ onDone }: { onDone: () => void }) {
  const [students, setStudents] = useState<RosterStudent[] | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  // Absence is the default (no check-in), so the server keeps no record of an Absent
  // mark. This roll call remembers its own, to tell "Absent" from "not asked yet".
  const [markedAbsent, setMarkedAbsent] = useState<Set<string>>(new Set());

  useEffect(() => {
    post({ action: 'roll-call' }).then(async (response) => {
      if (!response?.ok) {
        notify('Could not load the roster. Check the connection, then reopen roll call.');
        return;
      }
      setStudents((await response.json()).students);
    });
  }, []);

  const mark = async (present: boolean) => {
    if (!students) {
      return;
    }
    setBusy(true);
    try {
      const response = await post({ action: 'mark', userId: students[index].userId, present });
      if (!response?.ok) {
        notify('Could not record that. Check the connection, then try again.');
        return;
      }
      setStudents((await response.json()).students);
      const userId = students[index].userId;
      setMarkedAbsent((current) => {
        const next = new Set(current);
        if (present) next.delete(userId);
        else next.add(userId);
        return next;
      });
      setIndex((current) => current + 1);
    } finally {
      setBusy(false);
    }
  };

  if (!students) {
    return <Text c="dimmed">Loading the roster…</Text>;
  }
  const present = students.filter((student) => student.present).length;
  const student = students[index];

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={600}>
          Roll call: {present} of {students.length} present
        </Text>
        <Button variant="subtle" h={44} onClick={onDone}>
          Done
        </Button>
      </Group>
      {student ? (
        <Stack align="center" gap={6} style={{ textAlign: 'center' }} aria-live="polite">
          <Text c="dimmed">
            Student {index + 1} of {students.length}
          </Text>
          <Avatar
            src={student.photo}
            alt=""
            size="clamp(56px, 14dvh, 140px)"
            radius={140}
            color="buBlue"
          />
          <Text fz="clamp(26px, 5dvh, 36px)" fw={800} lh={1.1}>
            {student.name}
          </Text>
          {student.pronunciation && <Text fz={20}>{student.pronunciation}</Text>}
          <Text fz={22} fw={600} mt="xs">
            Present?
          </Text>
          <Group grow gap={12} w="100%">
            <Button size="xl" h={64} color="red.8" disabled={busy} onClick={() => mark(false)}>
              Absent
            </Button>
            <Button size="xl" h={64} color="green.9" disabled={busy} onClick={() => mark(true)}>
              Present
            </Button>
          </Group>
        </Stack>
      ) : (
        <Text fz={20} ta="center">
          Everyone is marked. Tap a name below to change a mark.
        </Text>
      )}
      <Stack gap={0}>
        {students.map((entry, position) => (
          <UnstyledButton
            key={entry.userId}
            onClick={() => setIndex(position)}
            style={{ minHeight: 44 }}
            aria-label={`Change the mark for ${entry.name}`}
          >
            <Group justify="space-between" wrap="nowrap">
              <Text fw={position === index ? 700 : 400}>{entry.name}</Text>
              <Badge
                color={entry.present ? 'green' : markedAbsent.has(entry.userId) ? 'red' : 'gray'}
                variant="light"
                tt="none"
              >
                {entry.present
                  ? 'Present'
                  : markedAbsent.has(entry.userId)
                    ? 'Absent'
                    : 'Not marked'}
              </Badge>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </Stack>
  );
}
