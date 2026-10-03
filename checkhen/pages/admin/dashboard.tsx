import { scopedFetch as fetch } from '@/lib/scoped-fetch';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Socket } from 'socket.io-client';
import {
  Avatar,
  Button,
  Card,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Box,
  Group,
  Badge,
  Flex,
  Tooltip,
  useMantineTheme,
  Alert,
  Divider,
} from '@mantine/core';
import {
  Hand,
  TrendingDown,
  CheckCircle,
  ArrowLeft,
  GraduationCap,
  Users,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Plus,
  User,
  Info,
} from 'lucide-react';
import ClassSessionManager from '@/components/Admin/ClassSessionManager/ClassSessionManager';
import { StudentProfileModal } from '@/components/Admin/StudentProfileModal';
import { notifications } from '@mantine/notifications';
import { getSocket } from '@/lib/socket';

type UserInfo = {
  id: string;
  emailAddresses: Array<{ emailAddress: string }>;
};

type HandRaise = {
  id: string;
  name: string;
  email: string;
  raisedAt: string;
  isAcknowledged: boolean;
};

type ChatMessage = {
  id: string;
  message: string;
  anonymousName: string | null;
  createdAt: string;
  user: {
    email: string;
    displayName: string | null;
    namePronunciation: string | null;
    pronouns: string | null;
  };
};

type AttendanceRecord = {
  id: string;
  userId: string;
  anonymousName: string | null;
  joinTime: string;
  user: {
    email: string;
    profilePicture: string | null;
    foodAllergies: string | null;
    displayName: string | null;
    namePronunciation: string | null;
    pronouns: string | null;
    bio: string | null;
  };
};

export default function AdminDashboard() {
  const router = useRouter();
  const theme = useMantineTheme();
  const ws = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const openModalRef = useRef<(() => void) | null>(null);

  // State variables
  const [user, setUser] = useState<UserInfo>();
  const [currentClassId, setCurrentClassId] = useState<string>('');
  const [currentClass, setCurrentClass] = useState<string>('');
  const [currentClassColor, setCurrentClassColor] = useState<string | null>(null);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [handRaises, setHandRaises] = useState<HandRaise[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [paceSignals, setPaceSignals] = useState({ slowDown: 0, readyToMove: 0 });
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(280);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const leftStartX = useRef(0);
  const leftStartWidth = useRef(0);
  const rightStartX = useRef(0);
  const rightStartWidth = useRef(0);

  const onLeftDragStart = (e: React.MouseEvent) => {
    leftStartX.current = e.clientX;
    leftStartWidth.current = leftWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - leftStartX.current;
      setLeftWidth(Math.max(160, Math.min(600, leftStartWidth.current + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const onRightDragStart = (e: React.MouseEvent) => {
    rightStartX.current = e.clientX;
    rightStartWidth.current = rightWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = rightStartX.current - ev.clientX;
      setRightWidth(Math.max(160, Math.min(600, rightStartWidth.current + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Auto-scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch user info
  const fetchUser = async () => {
    const response = await fetch('/api/get-user-info');
    const data = await response.json();
    setUser(data.user);
  };

  // Fetch check-ins (attendance)
  const fetchCheckInsData = async () => {
    const response = await fetch('/api/admin/fetch-check-ins');
    if (!response.ok) return;

    const data = await response.json();
    const jsonData = JSON.parse(data.message);
    setAttendance(jsonData);
  };

  // Fetch hand raises
  const fetchHandRaiseData = async () => {
    const response = await fetch('/api/admin/fetch-hand-raise');
    if (!response.ok) {
      setHandRaises([]);
      return;
    }

    const data = await response.json();
    const jsonData = JSON.parse(data.message);

    // Transform the data to match our HandRaise type
    const transformedData = jsonData.map((item: any) => ({
      id: item.id || item.email,
      name: item.name,
      email: item.email,
      raisedAt: new Date().toISOString(), // You may want to add this field to the API response
      isAcknowledged: item.isAck || false,
    }));

    setHandRaises(transformedData);
  };

  // Acknowledge hand raise
  const ackHandRaise = async (email: string) => {
    const res = await fetch('/api/admin/ack-hand-raise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      notifications.show({ title: 'Error', message: 'Could not acknowledge hand raise', color: 'red' });
      return;
    }
    ws.current?.emit('user-hand-acked', { email, classId: currentClassId });
    fetchHandRaiseData();
  };

  // Rate hand raise
  const rateHandRaise = async (email: string, good: boolean) => {
    const res = await fetch('/api/admin/rate-hand-raise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, good }),
    });

    if (!res.ok) {
      notifications.show({ title: 'Error', message: 'Could not rate hand raise', color: 'red' });
      return;
    }
    ws.current?.emit('user-hand-acked', { email, classId: currentClassId });
    fetchHandRaiseData();
  };

  // Fetch all chat messages
  const fetchAllChatMessages = async () => {
    const response = await fetch('/api/admin/fetch-all-chat');
    if (!response.ok) return;

    const data = await response.json();
    const jsonData = JSON.parse(data.message);
    setMessages(jsonData);
  };


  // Fetch pace signals
  const fetchPaceSignals = async () => {
    const response = await fetch('/api/student/fetch-pace-signals');
    if (response.ok) {
      const data = await response.json();
      setPaceSignals({
        slowDown: data.slowDown || 0,
        readyToMove: data.readyToMove || 0,
      });
    }
  };

  // Reset pace signals
  const resetPaceSignals = async () => {
    const response = await fetch('/api/admin/reset-pace-signals', {
      method: 'POST',
    });

    if (!response.ok) {
      notifications.show({ title: 'Error', message: 'Could not reset pace signals', color: 'red' });
      return;
    }
    setPaceSignals({ slowDown: 0, readyToMove: 0 });
    ws.current?.emit('pace-signals-reset', { classId: currentClassId });
  };

  // Initial setup
  useEffect(() => {
    fetchUser();
    fetchCheckInsData();
    fetchHandRaiseData();
    fetchAllChatMessages();
    fetchPaceSignals();

    const _interval = setInterval(() => {
      fetchCheckInsData();
      fetchHandRaiseData();
      fetchAllChatMessages();
      fetchPaceSignals();
    }, 10000);

    return () => clearInterval(_interval);
  }, []);

  // WebSocket setup
  useEffect(() => {
    if (!user || !currentClassId) return;

    const classId = currentClassId;
    ws.current = getSocket(classId);

    ws.current?.on('user-hand-update', () => {
      fetchHandRaiseData();
    });

    ws.current?.on('fetch-messages', () => {
      fetchAllChatMessages();
    });

    ws.current?.on('pace-signal-update', () => {
      fetchPaceSignals();
    });

    return () => {
      ws.current?.off('user-hand-update');
      ws.current?.off('fetch-messages');
      ws.current?.off('pace-signal-update');
      ws.current?.disconnect();
    };
  }, [user, currentClassId]);

  // Check if we should show pace alert (>30% want to slow down)
  const shouldShowPaceAlert =
    attendance.length > 0 && paceSignals.slowDown / attendance.length > 0.3;

  return (
    <Box style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper p="md" shadow="sm" withBorder style={{ borderRadius: 0 }}>
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
              <Text size="sm" c="dimmed">
                Instructor View
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              leftSection={<User size={16} />}
              onClick={() => router.push('/profile')}
            >
              My Profile
            </Button>
            <Button
              variant="light"
              onClick={() => router.push('/admin/analytics')}
            >
              Analytics
            </Button>
          </Group>
        </Group>
      </Paper>

      {/* Session Manager & Stats Bar */}
      <Paper
        p="md"
        shadow="xs"
        withBorder
        style={{
          borderRadius: 0,
          borderLeft: currentClassColor ? `4px solid ${currentClassColor}` : undefined,
        }}
      >
        <Stack gap="md">
          <ClassSessionManager
            currentClass={currentClass}
            setCurrentClass={setCurrentClass}
            currentClassId={currentClassId}
            setCurrentClassId={setCurrentClassId}
            onClassColor={(color) => setCurrentClassColor(color)}
            onOpenModal={(openFn) => { openModalRef.current = openFn; }}
            onReady={() => setDashboardReady(true)}
          />

          {currentClass && (
            <>
              <Divider />
              <Group gap="xl">
                {/* Attendance */}
                <Group gap="xs">
                  <Users size={20} color={theme.colors.buBlue[5]} />
                  <div>
                    <Text size="xs" c="dimmed">
                      Attendance
                    </Text>
                    <Text size="lg" fw={700}>
                      {attendance.length} students
                    </Text>
                  </div>
                </Group>

                {/* Pace Signals */}
                <Group gap="md">
                  <Group gap="xs">
                    <TrendingDown size={20} color={theme.colors.warning[5]} />
                    <div>
                      <Text size="xs" c="dimmed">
                        Slow Down
                      </Text>
                      <Text size="lg" fw={700}>
                        {paceSignals.slowDown}
                      </Text>
                    </div>
                  </Group>

                  <Group gap="xs">
                    <CheckCircle size={20} color={theme.colors.successGreen[5]} />
                    <div>
                      <Text size="xs" c="dimmed">
                        Ready
                      </Text>
                      <Text size="lg" fw={700}>
                        {paceSignals.readyToMove}
                      </Text>
                    </div>
                  </Group>

                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<RefreshCw size={14} />}
                    onClick={resetPaceSignals}
                  >
                    Reset
                  </Button>
                </Group>

                {/* Alert if >30% want to slow down */}
                {shouldShowPaceAlert && (
                  <Alert icon={<AlertCircle size={16} />} color="warning" variant="light">
                    <Text size="sm" fw={600}>
                      Class pace concern
                    </Text>
                  </Alert>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Paper>

      {/* Main Content */}
      {!dashboardReady ? (
        /* Loading — wait for ClassSessionManager to finish its first fetch */
        <Box style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader size="lg" />
        </Box>
      ) : !currentClass ? (
        /* Lobby - no active class */
        <Box
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(135deg, ${theme.colors.buBlue[0]} 0%, ${theme.colors.warmRed[0]} 100%)`,
          }}
        >
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
                <Users size={40} color={theme.colors.gray[5]} />
              </Box>
              <div>
                <Title order={2} mb="xs">No Active Class</Title>
                <Text c="dimmed" size="md">
                  Start a new class session so students can check in and participate.
                </Text>
              </div>
              <Button
                size="lg"
                leftSection={<Plus size={20} />}
                onClick={() => openModalRef.current?.()}
              >
                Create New Session
              </Button>
            </Stack>
          </Card>
        </Box>
      ) : (
      /* 3 Column Layout - active class */
      <Flex style={{ flex: 1, overflow: 'hidden' }}>
        {/* Left Column - Hand Raises */}
        <Box
          style={{
            width: leftWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Paper p="md" shadow="xs" withBorder style={{ borderRadius: 0 }}>
            <Group gap="xs">
              <Hand size={20} color={theme.colors.warning[5]} />
              <Title order={4}>Hands Raised ({handRaises.length})</Title>
            </Group>
          </Paper>

          <ScrollArea style={{ flex: 1 }} p="md">
            <Stack gap="sm">
              {handRaises.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" mt="xl">
                  No raised hands
                </Text>
              ) : (
                handRaises.map((raise) => (
                  <Card key={raise.id} padding="sm">
                    <Stack gap="xs">
                      <Group justify="space-between">
                        <Text
                          size="sm"
                          fw={600}
                          style={{ cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => setProfileEmail(raise.email)}
                        >
                          {raise.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {new Date(raise.raisedAt).toLocaleTimeString()}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {raise.email}
                      </Text>

                      <Group gap="xs" mt="xs">
                        {!raise.isAcknowledged ? (
                          <Button
                            size="xs"
                            variant="light"
                            fullWidth
                            onClick={() => ackHandRaise(raise.email)}
                          >
                            Acknowledge
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="xs"
                              variant="light"
                              color="successGreen"
                              style={{ flex: 1 }}
                              leftSection={<ThumbsUp size={14} />}
                              onClick={() => rateHandRaise(raise.email, true)}
                            >
                              Helpful
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              color="warmRed"
                              style={{ flex: 1 }}
                              leftSection={<ThumbsDown size={14} />}
                              onClick={() => rateHandRaise(raise.email, false)}
                            >
                              Not Now
                            </Button>
                          </>
                        )}
                      </Group>
                    </Stack>
                  </Card>
                ))
              )}
            </Stack>
          </ScrollArea>
        </Box>

        {/* Left drag handle */}
        <Box
          onMouseDown={onLeftDragStart}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: 'col-resize',
            background: theme.colors.gray[3],
            transition: 'background 0.15s',
            zIndex: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.colors.buBlue[4]; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.colors.gray[3]; }}
        />

        {/* Center Column - De-anonymized Chat */}
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Paper p="md" shadow="xs" withBorder style={{ borderRadius: 0 }}>
            <Title order={4}>Class Discussion</Title>
            <Text size="sm" c="dimmed">
              De-anonymized view (real names shown)
            </Text>
          </Paper>

          <ScrollArea style={{ flex: 1 }} p="md">
            <Stack gap="sm">
              {messages.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" mt="xl">
                  No messages yet
                </Text>
              ) : (
                messages.map((msg) => (
                  <Paper key={msg.id} p="sm" radius="md" bg={theme.colors.gray[0]}>
                    <Group justify="space-between" mb={4}>
                      <Group gap="xs">
                        <Text
                          size="sm"
                          fw={600}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setProfileEmail(msg.user.email)}
                        >
                          {msg.user.displayName || msg.user.email.split('@')[0]}
                        </Text>
                        <Badge size="xs" variant="light" color="gray">
                          as {msg.anonymousName || 'Anonymous'}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </Text>
                    </Group>
                    <Group gap={4} mb={4} wrap="wrap">
                      {msg.user.pronouns && (
                        <Badge size="xs" color="violet" variant="light">
                          {msg.user.pronouns}
                        </Badge>
                      )}
                      {msg.user.namePronunciation && (
                        <Badge size="xs" color="cyan" variant="light">
                          {msg.user.namePronunciation}
                        </Badge>
                      )}
                    </Group>
                    <Text size="sm">{msg.message}</Text>
                  </Paper>
                ))
              )}
              <div ref={messagesEndRef} />
            </Stack>
          </ScrollArea>
        </Box>

        {/* Right drag handle */}
        <Box
          onMouseDown={onRightDragStart}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: 'col-resize',
            background: theme.colors.gray[3],
            transition: 'background 0.15s',
            zIndex: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.colors.buBlue[4]; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.colors.gray[3]; }}
        />

        {/* Right Column - Attendance List */}
        <Box
          style={{
            width: rightWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Paper p="md" shadow="xs" withBorder style={{ borderRadius: 0 }}>
            <Group gap={4} align="center" wrap="nowrap">
              <Title order={4}>Present Students</Title>
              <Tooltip
                label={
                  <Stack gap={2}>
                    <Text size="xs" fw={600}>About check-in time:</Text>
                    <Text size="xs">Shows the student&apos;s most recent entry time.</Text>
                    <Text size="xs">If a student leaves and rejoins, only their latest check-in is reflected.</Text>
                  </Stack>
                }
                multiline
                w={260}
                withArrow
              >
                <Info size={14} style={{ cursor: 'pointer', opacity: 0.5 }} />
              </Tooltip>
            </Group>
          </Paper>

          <ScrollArea style={{ flex: 1 }} p="md">
            <Stack gap="xs">
              {attendance.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" mt="xl">
                  No students checked in
                </Text>
              ) : (
                attendance.map((record) => (
                  <Paper
                    key={record.id}
                    p="sm"
                    radius="md"
                    bg={theme.colors.gray[0]}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setProfileEmail(record.user.email)}
                  >
                    <Group gap="sm" align="flex-start">
                      <Avatar src={record.user.profilePicture} size={36} radius="50%" />
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>
                          {record.user.displayName || record.user.email.split('@')[0]}
                        </Text>
                        <Group justify="space-between" mt={2}>
                          <Badge size="xs" variant="light">
                            {record.anonymousName || 'No name'}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {new Date(record.joinTime).toLocaleTimeString()}
                          </Text>
                        </Group>
                        <Group gap={4} mt={4} wrap="wrap">
                          {record.user.pronouns && (
                            <Badge size="xs" color="violet" variant="light">
                              {record.user.pronouns}
                            </Badge>
                          )}
                          {record.user.namePronunciation && (
                            <Badge size="xs" color="cyan" variant="light">
                              {record.user.namePronunciation}
                            </Badge>
                          )}
                          {record.user.foodAllergies && (
                            <Badge size="xs" color="orange" variant="light">
                              Allergy: {record.user.foodAllergies}
                            </Badge>
                          )}
                        </Group>
                      </Box>
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </ScrollArea>
        </Box>
      </Flex>
      )}

      <StudentProfileModal
        email={profileEmail}
        onClose={() => setProfileEmail(null)}
      />
    </Box>
  );
}
