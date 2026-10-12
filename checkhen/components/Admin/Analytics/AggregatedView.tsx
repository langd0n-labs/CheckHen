import { Alert, Badge, Box, Card, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { useMantineTheme } from '@mantine/core';
import { Info } from 'lucide-react';

function TooltipCard({ label, rows }: { label: string; rows: { color: string; name: string; value: string }[] }) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid #dee2e6',
      borderRadius: 6,
      padding: '8px 12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      minWidth: 140,
      pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: '#212529' }}>{label}</div>
      {rows.map((row) => (
        <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: row.color, flexShrink: 0 }} />
          <span>{row.name}:</span>
          <span style={{ fontWeight: 600, color: '#212529' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

type PaceTimelineBucket = {
  minutesBucket: number;
  slowDown: number;
  readyToMove: number;
};

type LeaveEvent = {
  displayName: string | null;
  anonymousName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  durationMinutes: number | null;
  leftEarly: boolean;
};

type AggregatedStats = {
  totalStudents: number;
  avgDurationMinutes: number;
  absentMoreThan50Percent: number;
  avgMessagesPerStudent: number;
  avgHandRaisesPerStudent: number;
  paceSignalTimeline: PaceTimelineBucket[];
  leaveEvents: LeaveEvent[];
};

type StudentSummary = {
  email: string;
  displayName: string | null;
  durationMinutes: number | null;
  engagementScore: number | null;
};

type Props = {
  aggregated: AggregatedStats;
  classDuration: number;
  students: StudentSummary[];
  accentColor: string;
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card withBorder>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>{label}</Text>
      <Title order={2}>{value}</Title>
      {sub && <Text size="xs" c="dimmed" mt={2}>{sub}</Text>}
    </Card>
  );
}

export function AggregatedView({ aggregated, classDuration, students, accentColor }: Props) {
  const theme = useMantineTheme();
  const earlyLeaves = aggregated.leaveEvents.filter((e) => e.leftEarly);
  const stillPresent = aggregated.leaveEvents.filter((e) => e.checkOutTime === null);

  const studentLabel = (s: StudentSummary) => s.displayName || s.email.split('@')[0];

  const durationChartData = students.map((s, i) => ({
    index: i + 1,
    name: studentLabel(s),
    'Duration (min)': s.durationMinutes ?? 0,
  }));

  const engagementChartData = students
    .filter((s) => s.engagementScore !== null)
    .map((s, i) => ({
      index: i + 1,
      name: studentLabel(s),
      Score: s.engagementScore as number,
    }));

  return (
    <Stack gap="lg">
      {/* Stat cards */}
      <SimpleGrid cols={5} spacing="md">
        <StatCard
          label="Students"
          value={aggregated.totalStudents}
        />
        <StatCard
          label="Avg Time in Class"
          value={`${aggregated.avgDurationMinutes} min`}
          sub={`of ${classDuration} min planned`}
        />
        <StatCard
          label="Left Before 50%"
          value={aggregated.absentMoreThan50Percent}
          sub={aggregated.totalStudents > 0
            ? `${Math.round((aggregated.absentMoreThan50Percent / aggregated.totalStudents) * 100)}% of class`
            : undefined}
        />
        <StatCard
          label="Avg Messages"
          value={aggregated.avgMessagesPerStudent}
          sub="per student"
        />
        <StatCard
          label="Avg Hand Raises"
          value={aggregated.avgHandRaisesPerStudent}
          sub="per student"
        />
      </SimpleGrid>

      {/* Per-student bar charts */}
      {students.length > 0 && (
        <SimpleGrid cols={2} spacing="md">
          <Card>
            <Title order={5} mb="sm">Attendance Duration</Title>
            {durationChartData.length === 0 ? (
              <Text c="dimmed" size="sm">No data</Text>
            ) : (
              <BarChart
                h={220}
                data={durationChartData}
                dataKey="index"
                series={[{ name: 'Duration (min)', color: accentColor }]}
                tickLine="y"
                withTooltip
                tooltipAnimationDuration={0}
                withLegend={false}
                xAxisProps={{ tick: false, height: 8 }}
                yAxisProps={{ tick: { fontSize: 13 } }}
                tooltipProps={{
                  wrapperStyle: { zIndex: 10, outline: 'none' },
                  content: ({ payload }) => {
                    if (!payload?.length) return null;
                    const point = payload[0].payload;
                    return (
                      <TooltipCard
                        label={point.name}
                        rows={[{ color: accentColor, name: 'Duration', value: `${point['Duration (min)']} min` }]}
                      />
                    );
                  },
                }}
              />
            )}
          </Card>

          <Card>
            <Title order={5} mb="sm">Engagement Score</Title>
            {engagementChartData.length === 0 ? (
              <Text c="dimmed" size="sm">No data — students must check out for scores to compute</Text>
            ) : (
              <BarChart
                h={220}
                data={engagementChartData}
                dataKey="index"
                series={[{ name: 'Score', color: theme.colors.successGreen[5] }]}
                tickLine="y"
                withTooltip
                tooltipAnimationDuration={0}
                withLegend={false}
                xAxisProps={{ tick: false, height: 8 }}
                yAxisProps={{ tick: { fontSize: 13 } }}
                tooltipProps={{
                  wrapperStyle: { zIndex: 10, outline: 'none' },
                  content: ({ payload }) => {
                    if (!payload?.length) return null;
                    const point = payload[0].payload;
                    return (
                      <TooltipCard
                        label={point.name}
                        rows={[{ color: theme.colors.successGreen[5], name: 'Score', value: `${point['Score']} / 100` }]}
                      />
                    );
                  },
                }}
              />
            )}
          </Card>
        </SimpleGrid>
      )}

      {/* Pace signal timeline */}
      {aggregated.paceSignalTimeline.length > 0 && (
        <Card>
          <Title order={5} mb="xs">Pace Signals Over Time</Title>
          <Text size="xs" c="dimmed" mb="md">Signals submitted per {5}-minute window</Text>
          <BarChart
            h={200}
            data={aggregated.paceSignalTimeline.map((b) => ({
              label: `${b.minutesBucket}m`,
              'Slow Down': b.slowDown,
              'Ready': b.readyToMove,
            }))}
            dataKey="label"
            series={[
              { name: 'Slow Down', color: theme.colors.warning[5] },
              { name: 'Ready', color: theme.colors.successGreen[5] },
            ]}
            tickLine="y"
            withTooltip
            tooltipAnimationDuration={0}
            xAxisProps={{ tick: { fontSize: 11 } }}
            yAxisProps={{ tick: { fontSize: 11 }, allowDecimals: false }}
            tooltipProps={{
              wrapperStyle: { zIndex: 10, outline: 'none' },
              content: ({ payload }) => {
                if (!payload?.length) return null;
                const point = payload[0].payload;
                return (
                  <TooltipCard
                    label={`At ${point.label}`}
                    rows={[
                      { color: theme.colors.warning[5], name: 'Slow Down', value: String(point['Slow Down']) },
                      { color: theme.colors.successGreen[5], name: 'Ready', value: String(point['Ready']) },
                    ]}
                  />
                );
              },
            }}
          />
          <Group gap="md" mt="xs">
            <Group gap={4}>
              <Box w={12} h={12} style={{ borderRadius: 2, backgroundColor: theme.colors.warning[5] }} />
              <Text size="xs">Slow Down: {aggregated.paceSignalTimeline.reduce((s, b) => s + b.slowDown, 0)}</Text>
            </Group>
            <Group gap={4}>
              <Box w={12} h={12} style={{ borderRadius: 2, backgroundColor: theme.colors.successGreen[5] }} />
              <Text size="xs">Ready: {aggregated.paceSignalTimeline.reduce((s, b) => s + b.readyToMove, 0)}</Text>
            </Group>
          </Group>
        </Card>
      )}

      {/* Leave / checkout events */}
      <Card p={0}>
        <Stack gap={0}>
          <Group p="md" pb="xs" justify="space-between" align="flex-start">
            <div>
              <Title order={5}>Attendance Events</Title>
              <Text size="xs" c="dimmed">
                {earlyLeaves.length} left early · {stillPresent.length} still present
              </Text>
            </div>
          </Group>

          <Alert
            mx="md"
            mb="md"
            variant="light"
            color="blue"
            icon={<Info size={16} />}
          >
            Check-in time reflects the student&apos;s most recent entry. If a student left and rejoined, their latest check-in time is shown.
          </Alert>

          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Preferred Name</Table.Th>
                <Table.Th>Anonymous Name</Table.Th>
                <Table.Th>Check-In</Table.Th>
                <Table.Th>Check-Out</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {aggregated.leaveEvents.map((e, i) => {
                let statusBadge;
                if (e.checkOutTime === null) {
                  statusBadge = <Badge color="blue" variant="light" size="sm">Still Present</Badge>;
                } else if (e.durationMinutes !== null && e.durationMinutes < classDuration * 0.5) {
                  statusBadge = <Badge color="red" variant="light" size="sm">Left {'<'}50%</Badge>;
                } else if (e.leftEarly) {
                  statusBadge = <Badge color="orange" variant="light" size="sm">Left Early</Badge>;
                } else {
                  statusBadge = <Badge color="green" variant="light" size="sm">Stayed</Badge>;
                }

                return (
                  <Table.Tr key={i}>
                    <Table.Td>{e.displayName || e.anonymousName || '—'}</Table.Td>
                    <Table.Td>{e.anonymousName ?? '—'}</Table.Td>
                    <Table.Td>{formatTime(e.checkInTime)}</Table.Td>
                    <Table.Td>{formatTime(e.checkOutTime)}</Table.Td>
                    <Table.Td>{e.durationMinutes !== null ? `${e.durationMinutes} min` : '—'}</Table.Td>
                    <Table.Td>{statusBadge}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>
    </Stack>
  );
}
