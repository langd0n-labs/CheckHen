import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import {
  Box,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Title,
  useMantineTheme,
} from '@mantine/core';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import { AggregatedView } from '@/components/Admin/Analytics/AggregatedView';
import { StudentDetailView } from '@/components/Admin/Analytics/StudentDetailView';

type StudentSummary = {
  displayName: string | null;
  email: string;
  anonymousName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  durationMinutes: number | null;
  handRaiseCount: number;
  paceSignal: string | null;
  engagementScore: number | null;
};

type TemplateOption = {
  id: string;
  name: string;
  color: string;
};

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

type AnalyticsData = {
  students: StudentSummary[];
  paceAggregate: { slow_down: number; ready_to_move_on: number };
  classes: { id: string; name: string; createdAt: string; duration: number; color: string | null }[];
  selectedClass: { id: string; name: string; createdAt: string; duration: number; color: string | null } | null;
  aggregated?: AggregatedStats;
  allTime?: boolean;
  template?: TemplateOption | null;
  sessionCount?: number;
  totalPlannedMinutes?: number;
  templates?: TemplateOption[];
};

// Encode selection as a string for the <Select> value
const ALL_TIME_PREFIX = 'alltime:';

export default function AnalyticsPage() {
  const router = useRouter();
  const theme = useMantineTheme();
  const { data: session, status } = useSession();
  const isAdmin = (session?.user as any)?.isAdmin === true;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [selectValue, setSelectValue] = useState<string | null>(null);
  const [attendanceWeight, setAttendanceWeight] = useState(70);

  const fetchAnalytics = async (value?: string | null) => {
    setLoading(true);
    let url: string;
    if (value?.startsWith(ALL_TIME_PREFIX)) {
      const templateId = value.slice(ALL_TIME_PREFIX.length);
      url = `/api/admin/fetch-analytics?templateId=${templateId}&allTime=true`;
    } else if (value) {
      url = `/api/admin/fetch-analytics?classId=${value}`;
    } else {
      url = '/api/admin/fetch-analytics';
    }

    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) {
      router.push('/');
      return;
    }
    if (!res.ok) { setLoading(false); return; }

    const json: AnalyticsData = await res.json();
    setData(json);

    // Sync select value
    if (!value) {
      if (json.selectedClass) setSelectValue(json.selectedClass.id);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!isAdmin) { router.push('/'); return; }
    fetchAnalytics();
  }, [status, isAdmin]);

  const handleSelectChange = (value: string | null) => {
    if (!value) return;
    setSelectValue(value);
    fetchAnalytics(value);
  };

  const allTimeItems =
    data?.templates?.map((t) => ({
      value: `${ALL_TIME_PREFIX}${t.id}`,
      label: `All Sessions — ${t.name}`,
    })) ?? [];

  const sessionItems =
    data?.classes?.map((c) => ({
      value: c.id,
      label: `${c.name} — ${new Date(c.createdAt).toLocaleDateString()}`,
    })) ?? [];

  const classOptions = [
    ...(allTimeItems.length > 0 ? [{ group: 'Aggregated (All Sessions)', items: allTimeItems }] : []),
    ...(sessionItems.length > 0 ? [{ group: 'Individual Sessions', items: sessionItems }] : []),
  ];

  const accentColor =
    data?.allTime
      ? (data.template?.color ?? theme.colors.buBlue[5])
      : (data?.selectedClass?.color ?? theme.colors.buBlue[5]);

  const statsLabel = data?.allTime
    ? `${data.sessionCount} session${data.sessionCount !== 1 ? 's' : ''} · ${data.students.length} students total`
    : data?.selectedClass
    ? `${data.selectedClass.duration} min planned · ${data.students.length} students`
    : null;

  // All-time mode has no per-session aggregated stats (no meaningful pace timeline across sessions)
  const showOverviewTab = !data?.allTime && !!data?.aggregated;

  return (
    <Box style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper
        p="md"
        shadow="sm"
        withBorder
        style={{
          borderRadius: 0,
          borderLeft: `4px solid ${accentColor}`,
        }}
      >
        <Group justify="space-between">
          <Group>
            <Box
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                backgroundColor: accentColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GraduationCap size={20} color="white" />
            </Box>
            <div>
              <Title order={3}>CheckHen</Title>
              <Text size="sm" c="dimmed">Analytics</Text>
            </div>
          </Group>
          <Button
            variant="outline"
            leftSection={<ArrowLeft size={16} />}
            onClick={() => router.push('/admin/dashboard')}
          >
            Back to Dashboard
          </Button>
        </Group>
      </Paper>

      <Box p="md" style={{ flex: 1 }}>
        {/* Session selector */}
        <Group mb="md" align="flex-end">
          <Select
            label="Session"
            placeholder="Select a session"
            data={classOptions}
            value={selectValue}
            onChange={handleSelectChange}
            style={{ minWidth: 360 }}
          />
          {statsLabel && (
            <Text size="sm" c="dimmed">{statsLabel}</Text>
          )}
        </Group>

        {loading ? (
          <Stack align="center" mt="xl">
            <Loader />
            <Text c="dimmed">Loading analytics…</Text>
          </Stack>
        ) : !data || (!data.selectedClass && !data.allTime) ? (
          <Card ta="center" mt="xl">
            <Text c="dimmed">No session data found.</Text>
          </Card>
        ) : showOverviewTab ? (
          <Tabs defaultValue="overview">
            <Tabs.List mb="md">
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              <Tabs.Tab value="students">Per Student</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="overview">
              <AggregatedView
                aggregated={data.aggregated!}
                classDuration={data.selectedClass!.duration}
                students={data.students}
                accentColor={accentColor}
              />
            </Tabs.Panel>

            <Tabs.Panel value="students">
              <StudentDetailView data={data} accentColor={accentColor} />
            </Tabs.Panel>
          </Tabs>
        ) : (
          // All-time mode: no overview tab, just the student detail view
          <StudentDetailView
            data={data}
            accentColor={accentColor}
            attendanceWeight={data.allTime ? attendanceWeight : undefined}
            handRaiseWeight={data.allTime ? 100 - attendanceWeight : undefined}
            totalPlannedMinutes={data.totalPlannedMinutes}
            onAttendanceWeightChange={data.allTime ? setAttendanceWeight : undefined}
          />
        )}
      </Box>
    </Box>
  );
}
