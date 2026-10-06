import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Avatar, Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { SessionScopePicker } from '@/components/SessionScopePicker';
import { scopedFetch, selectedScope } from '@/lib/scoped-fetch';

type Outcome = 'answered' | 'pass' | 'retry' | 'absent' | 'skip';
type Student = {
  userId: string;
  name: string;
  pronunciation: string | null;
  pronouns: string | null;
  photo: string | null;
};
type Call = { id: string; userId: string; name: string; outcome: Outcome };

const outcomeLabel: Record<Outcome, string> = {
  answered: 'Answered',
  pass: 'Pass',
  retry: 'Retry',
  absent: 'Absent',
  skip: 'Skipped',
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** I3: the instructor's in-class phone screen. Call on someone, then one outcome tap. */
export default function ColdCall() {
  const [scoped, setScoped] = useState<boolean | null>(null);
  // `token` is the draw token, or a follow-up token while asking the same student again.
  const [student, setStudent] = useState<(Student & { token: string; followUp: boolean }) | null>(
    null
  );
  const [calls, setCalls] = useState<Call[]>([]);
  const [present, setPresent] = useState(0);
  const [busy, setBusy] = useState(false);

  const post = (body: Record<string, unknown>) =>
    scopedFetch('/api/admin/cold-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const refresh = useCallback(async () => {
    const response = await scopedFetch('/api/admin/cold-call');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    setCalls(data.calls);
    setPresent(data.present);
  }, []);

  useEffect(() => {
    const scope = selectedScope();
    setScoped(!!scope.courseId && !!scope.classId);
    if (scope.courseId && scope.classId) {
      refresh();
    }
  }, [refresh]);

  const fail = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => ({}));
    notifications.show({ message: body.message || fallback, color: 'red' });
  };

  const draw = async () => {
    setBusy(true);
    try {
      const response = await post({ action: 'draw' });
      if (response.ok) {
        const data = await response.json();
        setStudent({ ...data.student, token: data.draw, followUp: false });
      } else {
        await fail(response, 'Could not call on a student');
      }
    } finally {
      setBusy(false);
    }
  };

  const record = async (outcome: Outcome, next?: 'follow-up') => {
    if (!student) {
      return;
    }
    setBusy(true);
    try {
      const response = await post({
        action: 'record',
        outcome,
        [student.followUp ? 'followUp' : 'draw']: student.token,
        next,
      });
      if (response.ok) {
        const data = await response.json();
        // Answered + follow-up keeps the same student on screen for the next question.
        setStudent(data.followUp ? { ...student, token: data.followUp, followUp: true } : null);
        await refresh();
      } else {
        await fail(response, 'Could not record the outcome');
      }
    } finally {
      setBusy(false);
    }
  };

  const undo = async (eventId: string) => {
    const response = await post({ action: 'undo', eventId });
    if (response.ok) {
      await refresh();
    } else {
      await fail(response, 'Could not undo the call');
    }
  };

  if (scoped === null) {
    return null;
  }
  if (!scoped) {
    return (
      <Stack p="md">
        <Text>Choose the course and class session to call on students.</Text>
        <SessionScopePicker />
      </Stack>
    );
  }

  const last = calls.at(-1);
  return (
    <Box
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        gap: 16,
        maxWidth: 520,
        margin: '0 auto',
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {present} checked in
        </Text>
        <Text
          component={Link}
          href="/admin/dashboard"
          size="sm"
          c="buBlue.7"
          style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 8px' }}
        >
          Dashboard
        </Text>
      </Group>

      <Stack
        align="center"
        justify="center"
        gap={6}
        style={{ flex: 1, textAlign: 'center' }}
        aria-live="polite"
      >
        {student ? (
          <>
            {student.followUp && (
              <Text fz={18} c="dimmed">
                Follow-up question
              </Text>
            )}
            <Avatar src={student.photo} alt="" size={168} radius={168} color="buBlue">
              <Text fz={56} fw={700}>
                {initials(student.name)}
              </Text>
            </Avatar>
            <Text fz={40} fw={800} lh={1.1} mt="sm">
              {student.name}
            </Text>
            {student.pronunciation && (
              <Text fz={24} fw={500}>
                {student.pronunciation}
              </Text>
            )}
            {student.pronouns && (
              <Text fz={18} c="dimmed">
                {student.pronouns}
              </Text>
            )}
          </>
        ) : last ? (
          <Group gap="sm" justify="center">
            <Text fz={20}>
              {last.name}: {outcomeLabel[last.outcome]}
            </Text>
            <Button variant="subtle" size="md" h={44} onClick={() => undo(last.id)}>
              Undo
            </Button>
          </Group>
        ) : (
          <Text fz={20} c="dimmed">
            No one called yet this session.
          </Text>
        )}
      </Stack>

      {student ? (
        <Stack gap={12}>
          {/* The secondary action sits apart from the outcomes so it is not tapped by habit. */}
          {student.followUp ? (
            <Button variant="subtle" h={44} disabled={busy} onClick={() => setStudent(null)}>
              Done with follow-ups
            </Button>
          ) : (
            <Button variant="subtle" h={44} disabled={busy} onClick={() => record('skip')}>
              Skip (out of the room)
            </Button>
          )}
          <Group grow gap={12}>
            <Button
              size="xl"
              h={64}
              color="gray"
              variant="default"
              disabled={busy}
              onClick={() => record('pass')}
            >
              Pass
            </Button>
            <Button
              size="xl"
              h={64}
              color="yellow.4"
              c="dark.9"
              disabled={busy}
              onClick={() => record('retry')}
            >
              Retry
            </Button>
            {!student.followUp && (
              <Button
                size="xl"
                h={64}
                color="red.8"
                disabled={busy}
                onClick={() => record('absent')}
              >
                Absent
              </Button>
            )}
          </Group>
          <Button
            size="xl"
            h={64}
            color="green.9"
            variant="outline"
            disabled={busy}
            onClick={() => record('answered', 'follow-up')}
          >
            Answered + follow-up
          </Button>
          <Button
            size="xl"
            h={96}
            color="green.9"
            fz={28}
            disabled={busy}
            onClick={() => record('answered')}
          >
            Answered
          </Button>
        </Stack>
      ) : (
        <Button size="xl" h={160} fz={32} loading={busy} onClick={draw}>
          Call on someone
        </Button>
      )}

      {calls.length > 1 && !student && (
        <Stack gap={4} mt="md">
          <Text size="sm" fw={600}>
            Earlier calls this session
          </Text>
          {calls
            .slice(0, -1)
            .reverse()
            .map((call) => (
              <Group key={call.id} justify="space-between" wrap="nowrap">
                <Text size="md">
                  {call.name}: {outcomeLabel[call.outcome]}
                </Text>
                <UnstyledButton
                  onClick={() => undo(call.id)}
                  style={{ minHeight: 44, padding: '0 12px' }}
                  c="buBlue.7"
                >
                  Undo
                </UnstyledButton>
              </Group>
            ))}
        </Stack>
      )}
    </Box>
  );
}
