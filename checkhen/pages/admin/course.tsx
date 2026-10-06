import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { ColdCallConfig } from '@/lib/cold-call';
import type { CourseReport } from '@/lib/course-report';
import { selectedScope } from '@/lib/scoped-fetch';

type Payload = {
  course: { id: string; name: string };
  config: ColdCallConfig;
  defaults: ColdCallConfig;
  configProblem?: string | null;
  report: CourseReport;
};

/** Plain-language names for each setting, in the order the instructor reads them. */
const SETTINGS: { key: keyof ColdCallConfig; label: string; step: number }[] = [
  { key: 'term_meetings', label: 'Meetings in the term', step: 1 },
  { key: 'ratio', label: 'Target ratio (A is this share of the class median)', step: 0.05 },
  { key: 'A_min', label: 'Lowest A', step: 1 },
  { key: 'A_max', label: 'Highest A', step: 1 },
  { key: 'component_weight', label: 'Share of the course grade', step: 0.01 },
  { key: 'pass_multiplier', label: 'Extra weight per outstanding pass', step: 0.1 },
  { key: 'pass_cap', label: 'Most passes that add weight', step: 1 },
  { key: 'recency_multiplier', label: 'Extra weight per meeting since last called', step: 0.1 },
  { key: 'retry_multiplier', label: 'Weight with a retry outstanding', step: 0.1 },
  { key: 'never_called_multiplier', label: 'Weight if never called', step: 0.1 },
  { key: 'volunteer_damping', label: 'Weight after volunteering this meeting', step: 0.05 },
  { key: 'called_today_damping', label: 'Weight after being called this meeting', step: 0.05 },
  { key: 'minimum_weight', label: 'Lowest weight', step: 0.01 },
];

const date = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const percent = (value: number | null) =>
  value === null ? (
    <>
      –<VisuallyHidden>No score yet: no opportunities</VisuallyHidden>
    </>
  ) : (
    `${Math.round(value * 100)}%`
  );

/** I4: attendance, participation, the cold-call grade, exports, and settings for one course. */
export default function CourseRecord() {
  const [courseId, setCourseId] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (id: string) => {
    setFailed(false);
    const response = await fetch(
      `/api/admin/course-report?courseId=${encodeURIComponent(id)}`
    ).catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    const payload: Payload = await response.json();
    setData(payload);
    setDraft({ ...payload.config });
  }, []);

  useEffect(() => {
    const id = selectedScope().courseId ?? null;
    setCourseId(id);
    if (id) {
      load(id);
    }
  }, [load]);

  const post = async (body: Record<string, unknown>, done: string) => {
    if (!courseId) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/admin/course-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, ...body }),
      }).catch(() => null);
      if (!response) {
        notifications.show({
          message: 'Could not reach CheckHen. Check the connection, then try again.',
          color: 'red',
        });
        return;
      }
      const result = await response.json().catch(() => ({}));
      notifications.show(
        response.ok
          ? { message: done, color: 'green' }
          : { message: result.message || 'The change was not saved', color: 'red' }
      );
      if (response.ok) {
        await load(courseId);
      }
    } finally {
      setBusy(false);
    }
  };

  if (courseId === undefined) {
    return null;
  }
  if (!courseId) {
    return (
      <Text p="md">Choose a course above to see its attendance, participation, and grades.</Text>
    );
  }
  if (!data) {
    return failed ? (
      <Group p="md">
        <Text>Could not load the course record.</Text>
        <Button variant="light" onClick={() => load(courseId)}>
          Try again
        </Button>
      </Group>
    ) : (
      <Text p="md" c="dimmed">
        Loading the course record…
      </Text>
    );
  }
  const { report, config } = data;
  const exportUrl = (view: 'students' | 'sessions') =>
    `/api/admin/course-report?courseId=${encodeURIComponent(courseId)}&format=csv&view=${view}`;
  const open = report.absences.filter((absence) => !absence.excused);

  return (
    <Box p="lg" maw={1200} mx="auto">
      <Group justify="space-between" align="flex-start" mb="md" wrap="wrap">
        <Stack gap={4}>
          <Title order={1} fz={28}>
            {data.course.name}
          </Title>
          <Text size="lg">
            Target: A = {report.A} answers this term. A is provisional; it follows the class median.
          </Text>
          <Text c="dimmed">
            {report.sessionsHeld} meetings held
            {config.term_meetings ? ` of ${config.term_meetings} planned` : ''}. Volunteer answers
            count up to {Math.ceil(report.A / 2)}.
          </Text>
        </Stack>
        <Group gap="xs">
          <Button component="a" href={exportUrl('students')} variant="light">
            Export students (CSV)
          </Button>
          <Button component="a" href={exportUrl('sessions')} variant="light">
            Export sessions (CSV)
          </Button>
          <Anchor component={Link} href="/admin/dashboard" style={{ alignSelf: 'center' }}>
            Dashboard
          </Anchor>
        </Group>
      </Group>

      {data.configProblem && (
        <Alert color="red" mb="md" title="Saved settings could not be used">
          {data.configProblem}. Those settings use their defaults until valid values are saved in
          the Settings tab; saving there replaces them.
        </Alert>
      )}
      <Tabs defaultValue="students">
        <Tabs.List mb="md">
          <Tabs.Tab value="students">Students</Tabs.Tab>
          <Tabs.Tab value="sessions">Sessions</Tabs.Tab>
          <Tabs.Tab
            value="absences"
            rightSection={
              open.length ? (
                <Badge color="red.8" tt="none" size="sm">
                  {open.length}
                </Badge>
              ) : null
            }
          >
            Absences
          </Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="students">
          {report.students.length ? (
            <Table.ScrollContainer minWidth={900}>
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Student</Table.Th>
                    <Table.Th ta="right">Attended</Table.Th>
                    <Table.Th ta="right">Answers</Table.Th>
                    <Table.Th ta="right">Passes</Table.Th>
                    <Table.Th ta="right">Absences</Table.Th>
                    <Table.Th ta="right">Volunteered</Table.Th>
                    <Table.Th ta="right">Opportunities</Table.Th>
                    <Table.Th ta="right">Score</Table.Th>
                    <Table.Th ta="right">Exam fails</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {report.students.map((student) => (
                    <Table.Tr key={student.userId}>
                      <Table.Td>
                        <Text fw={600}>{student.name}</Text>
                        <Text size="sm" c="dimmed">
                          {student.email}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        {student.sessionsAttended} of {student.sessionsHeld}
                      </Table.Td>
                      <Table.Td ta="right">{student.answers}</Table.Td>
                      <Table.Td ta="right">{student.passes}</Table.Td>
                      <Table.Td ta="right">
                        {student.absences}
                        {student.excusedAbsences ? ` (+${student.excusedAbsences} excused)` : ''}
                      </Table.Td>
                      <Table.Td ta="right">
                        {student.volunteerAnswers}
                        {student.volunteerAnswers > student.volunteerCap
                          ? ` (${student.volunteerCap} count)`
                          : ''}
                      </Table.Td>
                      <Table.Td ta="right">{student.opportunities}</Table.Td>
                      <Table.Td ta="right" fw={700}>
                        {percent(student.score)}
                      </Table.Td>
                      <Table.Td ta="right">
                        {student.examFails}
                        {student.examFailsExcused ? ` (${student.examFailsExcused} excused)` : ''}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text>No active students on this roster yet. Add students to the roster first.</Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="sessions">
          <Text mb="sm" c="dimmed">
            Questions include follow-ups. Three kinds of question are not opportunities: a Pass on a
            follow-up, a Retry, and an excused absence. So these totals can exceed the
            students&apos; opportunities.
          </Text>
          {report.sessions.length ? (
            <Table.ScrollContainer minWidth={720}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Session</Table.Th>
                    <Table.Th ta="right">Checked in</Table.Th>
                    <Table.Th ta="right">Questions asked</Table.Th>
                    <Table.Th ta="right">Answers</Table.Th>
                    <Table.Th ta="right">Volunteered</Table.Th>
                    <Table.Th ta="right">Absences</Table.Th>
                    <Table.Th ta="right">Excused</Table.Th>
                    <Table.Th ta="right">Exam fails</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {report.sessions.map((session) => (
                    <Table.Tr key={session.classId}>
                      <Table.Td>{date(session.startedAt)}</Table.Td>
                      <Table.Td>{session.name}</Table.Td>
                      <Table.Td ta="right">{session.checkedIn}</Table.Td>
                      <Table.Td ta="right">{session.questions}</Table.Td>
                      <Table.Td ta="right">{session.answers}</Table.Td>
                      <Table.Td ta="right">{session.volunteerAnswers}</Table.Td>
                      <Table.Td ta="right">{session.absences}</Table.Td>
                      <Table.Td ta="right">{session.excusedAbsences}</Table.Td>
                      <Table.Td ta="right">{session.examFails}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text>No meetings held yet.</Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="absences">
          <Text mb="sm" c="dimmed">
            An absence is a student marked Absent during a cold call. Excusing it keeps it in the
            record but removes it from the student&apos;s opportunities.
          </Text>
          {report.absences.length ? (
            <Stack gap="xs">
              {report.absences.map((absence) => (
                <Group key={absence.callId} gap="md" wrap="wrap" align="center">
                  <Text miw={64}>{date(absence.startedAt)}</Text>
                  <Text fw={600} style={{ flex: '1 1 160px' }}>
                    {absence.name}
                  </Text>
                  {absence.excused ? (
                    <Group gap="xs">
                      <Text>Excused: {absence.reason}</Text>
                      <Button
                        variant="subtle"
                        disabled={busy}
                        aria-label={`Undo the excuse for ${absence.name} on ${date(absence.startedAt)}`}
                        onClick={() =>
                          post(
                            {
                              action: 'unexcuse',
                              classId: absence.classId,
                              callId: absence.callId,
                            },
                            'Excuse undone; the absence counts again'
                          )
                        }
                      >
                        Undo excuse
                      </Button>
                    </Group>
                  ) : (
                    <Group gap="xs">
                      <TextInput
                        aria-label={`Reason to excuse ${absence.name} on ${date(absence.startedAt)}`}
                        placeholder="Reason"
                        value={reasons[absence.callId] ?? ''}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setReasons((previous) => ({ ...previous, [absence.callId]: value }));
                        }}
                        style={{ flex: '1 1 200px', maxWidth: 320 }}
                      />
                      <Button
                        variant="light"
                        aria-label={`Excuse ${absence.name} on ${date(absence.startedAt)}`}
                        disabled={busy || !reasons[absence.callId]?.trim()}
                        onClick={() =>
                          post(
                            {
                              action: 'excuse',
                              classId: absence.classId,
                              callId: absence.callId,
                              reason: reasons[absence.callId].trim(),
                            },
                            'Absence excused'
                          )
                        }
                      >
                        Excuse
                      </Button>
                    </Group>
                  )}
                </Group>
              ))}
            </Stack>
          ) : (
            <Text>No absences recorded.</Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="settings">
          <Text mb="md" c="dimmed">
            These settings drive who is called and how participation is graded. Every export records
            the values in force. A itself is learned from the class and cannot be set.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" maw={760}>
            {SETTINGS.map(({ key, label, step }) => (
              <NumberInput
                key={key}
                label={label}
                description={
                  key === 'term_meetings'
                    ? 'Leave empty to project from the meetings held so far'
                    : `Default ${data.defaults[key]}`
                }
                value={draft[key] ?? ''}
                min={key === 'term_meetings' ? 1 : 0}
                step={step}
                allowDecimal={step < 1}
                error={
                  draft[key] === null && key !== 'term_meetings'
                    ? `Enter a value, or the default ${data.defaults[key]}`
                    : undefined
                }
                onChange={(value) =>
                  setDraft((previous) => ({
                    ...previous,
                    [key]: value === '' ? null : Number(value),
                  }))
                }
              />
            ))}
          </SimpleGrid>
          <Button
            mt="lg"
            loading={busy}
            disabled={SETTINGS.some(({ key }) => key !== 'term_meetings' && draft[key] === null)}
            onClick={() => post({ action: 'config', config: draft }, 'Settings saved')}
          >
            Save settings
          </Button>
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
