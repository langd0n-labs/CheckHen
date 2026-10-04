import { scopedFetch as fetch, selectedScope } from '@/lib/scoped-fetch';
import { useEffect, useRef, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import { Socket } from 'socket.io-client';
import {
  Alert,
  Button,
  Card,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Box,
  Group,
  Badge,
  Flex,
  TextInput,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import {
  Hand,
  TrendingDown,
  CheckCircle,
  Send,
  GraduationCap,
  LogOut,
  AlertTriangle,
  User,
} from 'lucide-react';
import { notifications } from '@mantine/notifications';
import { getSocket } from '@/lib/socket';

type UserInfo = {
  id: string;
  emailAddresses: Array<{ emailAddress: string }>;
};

type ChatMessage = {
  id: string;
  message: string;
  anonymousName: string | null;
  createdAt: string;
  isOwn: boolean;
};

export default function HomePage() {
  const { data: session, status } = useSession();
  const isAdmin = (session?.user as any)?.isAdmin === true;
  const router = useRouter();
  const theme = useMantineTheme();
  const ws = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // State variables
  const [user, setUser] = useState<UserInfo>();
  const [handRaised, setHandRaised] = useState(false);
  const [currentClassId, setCurrentClassId] = useState<string | null>(null);
  const [currentClassName, setCurrentClassName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [uplinkUnavailable, setUplinkUnavailable] = useState(false);
  const [checkInResolved, setCheckInResolved] = useState(false);
  const [anonymousName, setAnonymousName] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [paceSignals, setPaceSignals] = useState({ slowDown: 0, readyToMove: 0 });
  const [sendingMessage, setSendingMessage] = useState(false);
  const [classEnded, setClassEnded] = useState(false);
  const prevClassNameRef = useRef('');
  const isCheckedInRef = useRef(false);

  // Keep ref in sync with isCheckedIn state for use in closures
  useEffect(() => {
    isCheckedInRef.current = isCheckedIn;
  }, [isCheckedIn]);

  // Auto-scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Redirect admins to dashboard (isAdmin is embedded in the session token — no extra fetch)
  useEffect(() => {
    if (status !== 'authenticated' || router.query.preview === 'true') return;
    if (isAdmin) router.push('/admin/dashboard');
  }, [status, isAdmin, router]);

  // Fetches the current user's information from the backend
  const fetchUser = async () => {
    const response = await fetch('/api/get-user-info');
    const data = await response.json();
    setUser(data.user);
  };

  // Check if user is checked in to the current class
  const checkIfCheckedIn = async () => {
    const response = await fetch('/api/student/fetch-check-in');
    if (response.ok) setUplinkUnavailable(!(await fetch('/api/student/re-bind', { method: 'POST' })).ok);
    setIsCheckedIn(response.ok);
    setCheckInResolved(true);
    return response.ok;
  };

  // Fetch anonymous name
  const fetchAnonymousName = async () => {
    const response = await fetch('/api/student/get-anonymous-name');
    if (response.ok) {
      const data = await response.json();
      setAnonymousName(data.anonymousName);
    }
  };

  // Fetches the current hand raise status for the user
  const fetchHandRaiseStatus = async () => {
    const response = await fetch('/api/student/fetch-hand-raise');
    setHandRaised(response.ok);
  };

  // Toggles the hand raise status for the user
  const toggleHandRaise = async () => {
    const response = await fetch('/api/student/toggle-vhr', {
      method: 'POST',
    });

    if (!response.ok) {
      notifications.show({ title: 'Error', message: 'Could not update hand raise', color: 'red' });
      return;
    }

    const data = await response.json();
    setHandRaised(data.status);
    ws.current?.emit('user-hand-update', {
      classId: data.classId,
      isRaised: data.status,
    });
  };

  // Fetches the latest class session details
  const fetchCurrentClass = async () => {
    const response = await fetch('/api/fetch-latest-class');
    if (!response.ok) {
      if (prevClassNameRef.current && isCheckedInRef.current) setClassEnded(true);
      prevClassNameRef.current = '';
      setCurrentClassName('');
      return;
    }
    const data = await response.json();
    const jsonData = JSON.parse(data.message);
    const date = new Date(jsonData.createdAt);
    const endDate = new Date(date.getTime() + jsonData.duration * 60000);

    // If the class has ended, clear the current class name
    if (endDate < new Date()) {
      if (prevClassNameRef.current && isCheckedInRef.current) setClassEnded(true);
      prevClassNameRef.current = '';
      setCurrentClassName('');
      return;
    }

    const formattedDate = date.toLocaleString();

    // Avoid redundant updates if the class ID hasn't changed
    if (jsonData.id === currentClassId) {
      return;
    }

    const newName = `${jsonData.name} - ${formattedDate}`;
    prevClassNameRef.current = newName;
    setCurrentClassId(jsonData.id);
    setCurrentClassName(newName);
  };

  // Fetches all chat messages for the current class
  const fetchAllChatMessages = async () => {
    const response = await fetch('/api/student/fetch-all-chat');
    if (!response.ok) return;

    const data = await response.json();
    const jsonData = JSON.parse(data.message);

    setMessages(jsonData);
  };

  // Sends a new chat message
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;

    setSendingMessage(true);
    const response = await fetch('/api/student/send-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: chatInput }),
    });
    setSendingMessage(false);

    if (!response.ok) {
      notifications.show({ title: 'Error', message: 'Could not send message', color: 'red' });
      return;
    }

    setChatInput('');
    ws.current?.emit('chat-message-sent', {
      classId: currentClassId,
    });
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

  // Send pace signal
  const sendPaceSignal = async (signalType: 'slow_down' | 'ready_to_move_on') => {
    const response = await fetch('/api/student/send-pace-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signalType }),
    });

    if (!response.ok) {
      notifications.show({ title: 'Error', message: 'Could not send pace signal', color: 'red' });
      return;
    }

    ws.current?.emit('pace-signal-sent', {
      classId: currentClassId,
      signalType,
    });
    fetchPaceSignals();
  };

  // Initial setup: one startup request instead of 5+ serial fetches
  useEffect(() => {
    if (status !== 'authenticated') return;

    fetchUser();

    fetch('/api/student/startup')
      .then((r) => r.json())
      .then((d) => {
        if (d.isCheckedIn) {
          fetch('/api/student/re-bind', { method: 'POST' })
            .then(response => setUplinkUnavailable(!response.ok))
            .catch(() => setUplinkUnavailable(true));
          setIsCheckedIn(true);
          setCurrentClassId(d.classId);
          const date = d.classId ? new Date() : null; // class name comes from startup
          setCurrentClassName(d.className ?? '');
          setAnonymousName(d.anonymousName);
          setHandRaised(d.handRaised);
          setPaceSignals({ slowDown: d.paceSignals.slowDown, readyToMove: d.paceSignals.readyToMove });
          setMessages(d.messages);
          prevClassNameRef.current = d.className ?? '';
          isCheckedInRef.current = true;
        } else {
          setIsCheckedIn(false);
          if (d.classId) {
            setCurrentClassId(d.classId);
            setCurrentClassName(d.className ?? '');
          }
        }
        setCheckInResolved(true);
      });

    // Periodically refresh the current class details
    const _interval = setInterval(() => {
      fetchCurrentClass();
    }, 10000);

    return () => clearInterval(_interval);
  }, [status]);

  // Fallback poll for hand raise and pace signals when checked in (chat comes via socket)
  useEffect(() => {
    if (!isCheckedIn) return;

    const _dataInterval = setInterval(() => {
      fetch('/api/student/re-bind', { method: 'POST' })
        .then(response => setUplinkUnavailable(!response.ok))
        .catch(() => setUplinkUnavailable(true));
      fetchAllChatMessages();
      fetchHandRaiseStatus();
      fetchPaceSignals();
    }, 10000);

    return () => clearInterval(_dataInterval);
  }, [isCheckedIn]);

  // Check out when the browser tab/window is closed
  useEffect(() => {
    if (!isCheckedIn) return;

    const handleUnload = () => {
      const scope = selectedScope();
      if (scope.courseId && scope.classId) {
        const query = new URLSearchParams({ courseId: scope.courseId, classId: scope.classId });
        navigator.sendBeacon('/api/student/check-out?' + query);
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [isCheckedIn]);

  // Set up WebSocket connection when user and class ID are available
  useEffect(() => {
    if (!user || !currentClassId) return;

    const classId = currentClassId;
    ws.current = getSocket(classId);

    // Listen for updates
    ws.current?.on('check-raised-hands', () => {
      fetchHandRaiseStatus();
    });

    ws.current?.on('fetch-messages', () => {
      fetchAllChatMessages();
    });

    ws.current?.on('pace-signal-update', () => {
      fetchPaceSignals();
    });

    ws.current?.on('pace-signals-reset', () => {
      setPaceSignals({ slowDown: 0, readyToMove: 0 });
    });

    // Lower hand immediately when instructor acknowledges it
    ws.current?.on('check-raised-hands', () => {
      fetchHandRaiseStatus();
    });

    return () => {
      ws.current?.off('check-raised-hands');
      ws.current?.off('fetch-messages');
      ws.current?.off('pace-signal-update');
      ws.current?.off('pace-signals-reset');
    };
  }, [user, currentClassId]);

  // Sign out after marking the student as not present
  const handleSignOut = async () => {
    await fetch('/api/student/check-out', { method: 'POST' });
    signOut({ callbackUrl: '/' });
  };

  // Leave the current class without signing out (logo click)
  const handleLeaveClass = async () => {
    await fetch('/api/student/check-out', { method: 'POST' });
    router.push('/join');
  };

  // Handle Enter key in chat input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  // Show sign-in prompt if not authenticated
  if (status === 'unauthenticated') {
    return (
      <Box
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
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
            <Text c="dimmed" ta="center">
              Please sign in with your BU account
            </Text>
            <Button onClick={() => signIn('google')} size="lg" fullWidth>
              Sign In with Google
            </Button>
          </Stack>
        </Card>
      </Box>
    );
  }

  // Show loading while checking auth
  if (status === 'loading') {
    return (
      <Box
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text>Loading...</Text>
      </Box>
    );
  }

  // Redirect to /join if authenticated, check-in resolved, not checked in, and not in preview mode
  if (checkInResolved && !isCheckedIn && status === 'authenticated' && router.isReady && router.query.preview !== 'true') {
    router.push('/join');
    return (
      <Box style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  // Main checked-in view - Split screen layout
  return (
    <Box style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper p="md" shadow="sm" withBorder style={{ borderRadius: 0 }}>
        <Group justify="space-between">
          <Group>
            <Tooltip label="Leave class" withArrow>
              <Box
                onClick={handleLeaveClass}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  backgroundColor: theme.colors.buBlue[5],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <GraduationCap size={20} color="white" />
              </Box>
            </Tooltip>
            <div>
              <Title order={3}>CheckHen</Title>
              <Text size="sm" c="dimmed">
                {currentClassName}
              </Text>
            </div>
          </Group>
          <Group gap="sm">
            {anonymousName && (
              <Badge size="lg" variant="light" color="buBlue">
                {anonymousName}
              </Badge>
            )}
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              leftSection={<User size={16} />}
              onClick={() => router.push('/profile')}
            >
              Profile
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              leftSection={<LogOut size={16} />}
              onClick={handleSignOut}
            >
              Sign Out
            </Button>
          </Group>
        </Group>
      </Paper>

      {/* Class ended notification */}
      {classEnded && (
        <Alert
          icon={<AlertTriangle size={18} />}
          title="Class has ended"
          color="orange"
          withCloseButton
          onClose={() => setClassEnded(false)}
          style={{ borderRadius: 0, borderBottom: `1px solid ${theme.colors.orange[3]}` }}
        >
          The instructor has ended this class session.
        </Alert>
      )}

      {uplinkUnavailable && (
        <Alert icon={<AlertTriangle size={18} />} title="No uplink" color="red" style={{ borderRadius: 0 }}>
          This device has no internet access through the class network. Check in again or ask your instructor for help.
        </Alert>
      )}

      {/* Main Content - Split screen */}
      <Flex style={{ flex: 1, overflow: 'hidden' }}>
        {/* Left Column - Controls (40%) */}
        <Box
          style={{
            width: '40%',
            borderRight: `1px solid ${theme.colors.gray[3]}`,
            display: 'flex',
            flexDirection: 'column',
            padding: theme.spacing.md,
          }}
        >
          <Stack gap="md">
            {/* Hand Raise */}
            <Card padding="md">
              <Stack gap="sm">
                <Title order={5}>Request to Speak</Title>
                <Button
                  size="lg"
                  fullWidth
                  color={handRaised ? 'warning' : 'buBlue'}
                  leftSection={<Hand size={20} />}
                  onClick={toggleHandRaise}
                  disabled={!currentClassName}
                >
                  {handRaised ? 'Lower Hand' : 'Raise Hand'}
                </Button>
              </Stack>
            </Card>

            {/* Pace Signals */}
            <Card padding="md">
              <Stack gap="sm">
                <Title order={5}>Class Pace Feedback</Title>
                <Text size="sm" c="dimmed">
                  Let your instructor know how you're doing
                </Text>

                <Group grow>
                  <Button
                    variant="light"
                    color="warning"
                    leftSection={<TrendingDown size={18} />}
                    onClick={() => sendPaceSignal('slow_down')}
                    disabled={!currentClassName}
                  >
                    Slow Down
                  </Button>
                  <Button
                    variant="light"
                    color="successGreen"
                    leftSection={<CheckCircle size={18} />}
                    onClick={() => sendPaceSignal('ready_to_move_on')}
                    disabled={!currentClassName}
                  >
                    Ready
                  </Button>
                </Group>

                <Group justify="center" gap="xl" mt="xs">
                  <Group gap="xs">
                    <TrendingDown size={16} color={theme.colors.warning[5]} />
                    <Text size="sm" fw={600}>
                      {paceSignals.slowDown}
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <CheckCircle size={16} color={theme.colors.successGreen[5]} />
                    <Text size="sm" fw={600}>
                      {paceSignals.readyToMove}
                    </Text>
                  </Group>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Box>

        {/* Right Column - Chat (60%) */}
        <Box
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Paper p="md" shadow="xs" withBorder style={{ borderRadius: 0 }}>
            <Title order={4}>Class Discussion</Title>
            <Text size="sm" c="dimmed">
              Messages are shown with anonymous names
            </Text>
          </Paper>

          {/* Messages */}
          <ScrollArea style={{ flex: 1 }} p="md">
            <Stack gap="sm">
              {messages.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" mt="xl">
                  No messages yet. Start the conversation!
                </Text>
              ) : (
                messages.map((msg) => {
                  const isOwnMessage = msg.isOwn;
                  return (
                    <Paper
                      key={msg.id}
                      p="sm"
                      radius="md"
                      bg={isOwnMessage ? theme.colors.buBlue[0] : theme.colors.gray[0]}
                      style={{
                        marginLeft: isOwnMessage ? 'auto' : 0,
                        marginRight: isOwnMessage ? 0 : 'auto',
                        maxWidth: '80%',
                      }}
                    >
                      <Group justify="space-between" mb={4}>
                        <Badge size="xs" variant="light" color={isOwnMessage ? 'buBlue' : 'gray'}>
                          {msg.anonymousName || 'Anonymous'}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {new Date(msg.createdAt).toLocaleTimeString()}
                        </Text>
                      </Group>
                      <Text size="sm">{msg.message}</Text>
                    </Paper>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </Stack>
          </ScrollArea>

          {/* Chat Input */}
          <Paper p="md" withBorder style={{ borderRadius: 0 }}>
            <Group gap="sm">
              <TextInput
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ flex: 1 }}
                disabled={!currentClassName}
              />
              <Button
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || !currentClassName}
                loading={sendingMessage}
                leftSection={<Send size={16} />}
              >
                Send
              </Button>
            </Group>
          </Paper>
        </Box>
      </Flex>
    </Box>
  );
}
