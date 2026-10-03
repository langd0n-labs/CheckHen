import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useEffect, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import {
  Box,
  Button,
  Card,
  Stack,
  Text,
  Title,
  Badge,
  Group,
  useMantineTheme,
  Loader,
} from '@mantine/core';
import { GraduationCap, BookOpen, Clock, Users, User } from 'lucide-react';
import { notifications } from '@mantine/notifications';

type ActiveClass = {
  id: string;
  name: string;
  createdAt: string;
  duration: number;
  color?: string | null;
};

export default function JoinPage() {
  const { data: session, status } = useSession();
  const isAdmin = (session?.user as any)?.isAdmin === true;
  const router = useRouter();
  const theme = useMantineTheme();

  const [activeClasses, setActiveClasses] = useState<ActiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Redirect instructors away (isAdmin from session token — no extra fetch)
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (isAdmin) router.push('/admin/dashboard');
  }, [status, isAdmin, router]);

  // Fetch active classes
  const fetchActiveClasses = async () => {
    const response = await fetch('/api/fetch-latest-class');
    if (!response.ok) {
      setActiveClasses([]);
      return;
    }
    const data = await response.json();
    const cls = JSON.parse(data.message);
    const endDate = new Date(new Date(cls.createdAt).getTime() + cls.duration * 60000);
    if (endDate < new Date()) {
      setActiveClasses([]);
    } else {
      setActiveClasses([cls]);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      // Wait for both the check-in check and class fetch before showing the page
      Promise.all([
        fetch('/api/student/fetch-check-in').then((res) => {
          if (res.ok) router.push('/');
        }),
        fetchActiveClasses(),
      ]).finally(() => setLoading(false));

      // Poll for new classes every 10s
      const interval = setInterval(fetchActiveClasses, 10000);
      return () => clearInterval(interval);
    }
  }, [status]);

  const handleJoin = async (classId: string) => {
    setJoiningId(classId);
    const response = await fetch('/api/student/check-in', { method: 'POST' });
    if (response.ok) {
      router.push('/');
    } else {
      notifications.show({ title: 'Error', message: 'Could not join class. Please try again.', color: 'red' });
      setJoiningId(null);
    }
  };

  // Sign-in screen
  if (status === 'unauthenticated') {
    return (
      <Box
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${theme.colors.buBlue[0]} 0%, ${theme.colors.warmRed[0]} 100%)`,
        }}
      >
        <Card shadow="lg" padding="xl" radius="md" style={{ maxWidth: 400, width: '100%' }}>
          <Stack align="center" gap="md">
            <Box
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                backgroundColor: theme.colors.buBlue[5],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GraduationCap size={30} color="white" />
            </Box>
            <Title order={2}>Welcome to CheckHen</Title>
            <Text c="dimmed" ta="center">Please sign in with your BU account</Text>
            <Button onClick={() => signIn('google')} size="lg" fullWidth>
              Sign In with Google
            </Button>
          </Stack>
        </Card>
      </Box>
    );
  }

  // Loading
  if (status === 'loading' || loading) {
    return (
      <Box style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader size="lg" />
      </Box>
    );
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(135deg, ${theme.colors.buBlue[0]} 0%, ${theme.colors.warmRed[0]} 100%)`,
      }}
    >
      {/* Header */}
      <Box
        style={{
          backgroundColor: 'white',
          borderBottom: `1px solid ${theme.colors.gray[3]}`,
          padding: theme.spacing.md,
        }}
      >
        <Group justify="space-between">
          <Group>
            <Box
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                backgroundColor: theme.colors.buBlue[5],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GraduationCap size={20} color="white" />
            </Box>
            <div>
              <Title order={3}>CheckHen</Title>
              <Text size="sm" c="dimmed">Join a Class</Text>
            </div>
          </Group>
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            leftSection={<User size={16} />}
            onClick={() => router.push('/profile')}
          >
            Profile
          </Button>
        </Group>
      </Box>

      {/* Main content */}
      <Box
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: activeClasses.length === 0 ? 'center' : 'flex-start',
          padding: theme.spacing.xl,
        }}
      >
        {activeClasses.length === 0 ? (
          /* No active classes empty state */
          <Card shadow="lg" padding="xl" radius="md" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
            <Stack align="center" gap="lg">
              <Box
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  backgroundColor: theme.colors.gray[1],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <BookOpen size={40} color={theme.colors.gray[5]} />
              </Box>
              <div>
                <Title order={2} mb="xs">No Active Classes</Title>
                <Text c="dimmed" size="md">
                  There are no class sessions running right now.
                  <br />
                  Please wait for your instructor to start one.
                </Text>
              </div>
              <Button variant="light" onClick={fetchActiveClasses}>
                Refresh
              </Button>
            </Stack>
          </Card>
        ) : (
          /* Class list */
          <Stack gap="md" style={{ maxWidth: 560, width: '100%' }}>
            <div>
              <Title order={2} mb={4}>Active Classes</Title>
              <Text c="dimmed" size="sm">Select a session to join</Text>
            </div>

            {activeClasses.map((cls) => {
              const startDate = new Date(cls.createdAt);
              const endDate = new Date(startDate.getTime() + cls.duration * 60000);
              const minutesLeft = Math.max(0, Math.round((endDate.getTime() - Date.now()) / 60000));
              const accent = cls.color ?? theme.colors.buBlue[5];
              const accentLight = cls.color ? `${cls.color}20` : theme.colors.buBlue[0];

              return (
                <Card
                  key={cls.id}
                  shadow="sm"
                  padding="lg"
                  radius="md"
                  style={{ borderLeft: `4px solid ${accent}` }}
                >
                  <Group justify="space-between" align="flex-start" mb="md">
                    <Group gap="sm">
                      <Box
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: theme.radius.md,
                          backgroundColor: accentLight,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Users size={22} color={accent} />
                      </Box>
                      <div>
                        <Title order={4}>{cls.name}</Title>
                        <Text size="sm" c="dimmed">
                          Started {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </div>
                    </Group>
                    <Badge
                      color="successGreen"
                      variant="light"
                      leftSection={<Clock size={12} />}
                    >
                      {minutesLeft}m left
                    </Badge>
                  </Group>

                  <Button
                    fullWidth
                    size="md"
                    loading={joiningId === cls.id}
                    onClick={() => handleJoin(cls.id)}
                    style={cls.color ? { backgroundColor: cls.color } : undefined}
                  >
                    Join Session
                  </Button>
                </Card>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
