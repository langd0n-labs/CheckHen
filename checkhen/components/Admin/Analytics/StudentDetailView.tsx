import { Box, Card, Group, Slider, Stack, Table, Text, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { useMantineTheme } from '@mantine/core';
import { useState } from 'react';
import { Info, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { StudentProfileModal } from '../StudentProfileModal';

type StudentSummary = {
  email: string;
  displayName: string | null;
  anonymousName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  durationMinutes: number | null;
  handRaiseCount: number;
  paceSignal: string | null;
  engagementScore: number | null;
};

type AnalyticsData = {
  students: StudentSummary[];
  paceAggregate: { slow_down: number; ready_to_move_on: number };
  selectedClass: { id: string; name: string; createdAt: string; duration: number; color: string | null } | null;
  allTime?: boolean;
  sessionCount?: number;
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatPaceSignal(signal: string | null) {
  if (!signal) return '—';
  if (signal === 'slow_down') return 'Slow Down';
  if (signal === 'ready_to_move_on') return 'Ready';
  return signal;
}

type Props = {
  data: AnalyticsData;
  accentColor: string;
  attendanceWeight?: number;
  handRaiseWeight?: number;
  totalPlannedMinutes?: number;
  onAttendanceWeightChange?: (v: number) => void;
};

type SortKey = 'name' | 'duration' | 'attendance' | 'handRaises' | 'score';
type SortDir = 'asc' | 'desc';

function recomputeScore(
  s: StudentSummary,
  attendanceWeight: number,
  handRaiseWeight: number,
  totalPlannedMinutes: number,
): number | null {
  if (s.durationMinutes === null) return null;
  const attendanceScore = Math.min(s.durationMinutes / totalPlannedMinutes, 1) * attendanceWeight;
  const handScore = Math.min(s.handRaiseCount, 5) * (handRaiseWeight / 5);
  return Math.round(attendanceScore + handScore);
}

export function StudentDetailView({ data, accentColor, attendanceWeight, handRaiseWeight, totalPlannedMinutes, onAttendanceWeightChange }: Props) {
  const theme = useMantineTheme();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [profileEmail, setProfileEmail] = useState<string | null>(null);

  const useCustomWeights = data.allTime && attendanceWeight !== undefined && handRaiseWeight !== undefined && totalPlannedMinutes !== undefined;
  const students = useCustomWeights
    ? data.students.map((s) => ({
        ...s,
        engagementScore: recomputeScore(s, attendanceWeight!, handRaiseWeight!, totalPlannedMinutes!),
      }))
    : data.students;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  function SortHeader({ col, label, children }: { col: SortKey; label?: React.ReactNode; children?: React.ReactNode }) {
    const active = sortKey === col;
    const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <UnstyledButton
        onClick={() => handleSort(col)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, fontSize: 'inherit', whiteSpace: 'nowrap' }}
      >
        {label ?? children}
        <Icon size={13} style={{ opacity: active ? 1 : 0.35, flexShrink: 0 }} />
      </UnstyledButton>
    );
  }


  return (
    <Stack gap="lg">
      {/* Engagement score weights slider (all-time only) */}
      {data.allTime && (
        <Card>
          <Title order={5} mb={4}>Engagement Score Weights</Title>
          <Text size="xs" c="dimmed" mb="lg">
            Attendance: {attendanceWeight ?? 70}% · Hand Raises: {100 - (attendanceWeight ?? 70)}%
          </Text>
          <Slider
            value={attendanceWeight ?? 70}
            onChange={onAttendanceWeightChange}
            min={0}
            max={100}
            step={5}
            marks={[
              { value: 0, label: '0%' },
              { value: 50, label: '50%' },
              { value: 100, label: '100%' },
            ]}
            label={(v) => `Attendance ${v}%`}
            color={accentColor}
            mb={40}
          />
          <Text size="xs" c="dimmed">
            Drag to adjust how much attendance vs. hand raises contribute to the score.
          </Text>
        </Card>
      )}

      {/* Detail table */}
      <Card p={0}>
        <Box p="md" pb="xs">
          <Title order={5}>Student Detail</Title>
          {data.allTime && (
            <Text size="xs" c="dimmed">
              Duration and hand raises are totals across all {data.sessionCount} sessions.
            </Text>
          )}
        </Box>
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th><SortHeader col="name" label="Preferred Name" /></Table.Th>
              {!data.allTime && <Table.Th>Anonymous Name</Table.Th>}
              <Table.Th>Email</Table.Th>
              {!data.allTime && <Table.Th>Check-In</Table.Th>}
              {!data.allTime && <Table.Th>Check-Out</Table.Th>}
              <Table.Th>
                <SortHeader
                  col="duration"
                  label={
                    data.allTime && totalPlannedMinutes
                      ? `Total Duration (out of ${totalPlannedMinutes} min)`
                      : data.selectedClass
                      ? `Duration (out of ${data.selectedClass.duration} min)`
                      : 'Duration'
                  }
                />
              </Table.Th>
              <Table.Th><SortHeader col="attendance" label="Attendance %" /></Table.Th>
              <Table.Th><SortHeader col="handRaises" label="Hand Raises" /></Table.Th>
              {!data.allTime && <Table.Th>Pace Signal</Table.Th>}
              <Table.Th>
                <Group gap={4} align="center" wrap="nowrap">
                  <SortHeader col="score" label="Score" />
                  <Tooltip
                    label={
                      useCustomWeights ? (
                        <Stack gap={2}>
                          <Text size="xs" fw={600}>Score is out of 100:</Text>
                          <Text size="xs">• Up to {attendanceWeight}pts for time attended</Text>
                          <Text size="xs">• Up to {handRaiseWeight}pts for hand raises (max 5)</Text>
                        </Stack>
                      ) : (
                        <Stack gap={2}>
                          <Text size="xs" fw={600}>Score is out of 100:</Text>
                          <Text size="xs">• Up to 60pts for time attended</Text>
                          <Text size="xs">• Up to 30pts for hand raises (6pts each, max 5)</Text>
                          <Text size="xs">• 10pts for submitting a pace signal</Text>
                        </Stack>
                      )
                    }
                    multiline
                    w={260}
                    withArrow
                  >
                    <Info size={14} style={{ cursor: 'pointer', opacity: 0.5 }} />
                  </Tooltip>
                </Group>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...students]
              .sort((a, b) => {
                let cmp = 0;
                if (sortKey === 'name') {
                  const na = (a.displayName || a.email.split('@')[0]).toLowerCase();
                  const nb = (b.displayName || b.email.split('@')[0]).toLowerCase();
                  cmp = na.localeCompare(nb);
                } else if (sortKey === 'duration') {
                  cmp = (a.durationMinutes ?? -1) - (b.durationMinutes ?? -1);
                } else if (sortKey === 'attendance') {
                  const planned = data.allTime ? (totalPlannedMinutes ?? 0) : (data.selectedClass?.duration ?? 0);
                  const pa = planned > 0 && a.durationMinutes !== null ? a.durationMinutes / planned : -1;
                  const pb = planned > 0 && b.durationMinutes !== null ? b.durationMinutes / planned : -1;
                  cmp = pa - pb;
                } else if (sortKey === 'handRaises') {
                  cmp = a.handRaiseCount - b.handRaiseCount;
                } else if (sortKey === 'score') {
                  cmp = (a.engagementScore ?? -1) - (b.engagementScore ?? -1);
                }
                return sortDir === 'asc' ? cmp : -cmp;
              })
              .map((s) => {
                const isShortSession =
                  !data.allTime && s.durationMinutes !== null && s.durationMinutes < 10;
                return (
                  <Table.Tr
                    key={s.email}
                    style={isShortSession ? { backgroundColor: theme.colors.buBlue[0] } : undefined}
                  >
                    <Table.Td>
                      <Text
                        size="sm"
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => setProfileEmail(s.email)}
                      >
                        {s.displayName || s.email.split('@')[0]}
                      </Text>
                    </Table.Td>
                    {!data.allTime && <Table.Td>{s.anonymousName ?? '—'}</Table.Td>}
                    <Table.Td>{s.email}</Table.Td>
                    {!data.allTime && <Table.Td>{formatTime(s.checkInTime)}</Table.Td>}
                    {!data.allTime && <Table.Td>{formatTime(s.checkOutTime)}</Table.Td>}
                    <Table.Td>
                      {s.durationMinutes !== null ? `${s.durationMinutes} min` : '—'}
                    </Table.Td>
                    <Table.Td>
                      {(() => {
                        const planned = data.allTime ? (totalPlannedMinutes ?? 0) : (data.selectedClass?.duration ?? 0);
                        if (s.durationMinutes === null || planned === 0) return '—';
                        const pct = Math.min(Math.round((s.durationMinutes / planned) * 100), 100);
                        return `${pct}%`;
                      })()}
                    </Table.Td>
                    <Table.Td>{s.handRaiseCount}</Table.Td>
                    {!data.allTime && <Table.Td>{formatPaceSignal(s.paceSignal)}</Table.Td>}
                    <Table.Td>
                      {s.engagementScore !== null ? `${s.engagementScore} / 100` : '—'}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
          </Table.Tbody>
        </Table>
      </Card>
      <StudentProfileModal email={profileEmail} onClose={() => setProfileEmail(null)} />
    </Stack>
  );
}
