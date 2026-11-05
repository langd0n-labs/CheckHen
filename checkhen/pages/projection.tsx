import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { io } from 'socket.io-client';
import { Box, Paper, Stack, Text, Title } from '@mantine/core';

type ProjectedMessage = { id: string; message: string; anonymousName: string; createdAt: string };

export default function ProjectionPage() {
  const router = useRouter();
  const ticket = router.query.ticket;
  const [messages, setMessages] = useState<ProjectedMessage[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof ticket !== 'string' || !ticket) return;
    let live = true;
    // Only the newest request may change what the room sees.
    let latest = 0;
    const refresh = async () => {
      const request = ++latest;
      try {
        const response = await fetch(`/api/projection/chat?ticket=${encodeURIComponent(ticket)}`);
        if (!live || request !== latest) return;
        if (response.status === 401 || response.status === 403) {
          // A refused ticket never works again: clear the chat and stop asking.
          stop();
          setMessages([]);
          setError('Projection access expired. Open a new projection from the instructor dashboard.');
          return;
        }
        if (!response.ok) throw new Error('Chat unavailable');
        const result = await response.json();
        if (live && request === latest) { setMessages(result.messages); setError(''); }
      } catch {
        if (live && request === latest) setError('Chat unavailable');
      }
    };
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:6060';
    const socket = io(socketUrl || undefined, { auth: { ticket } });
    // Socket notifications bring new messages at once; the poll is only a fallback.
    const timer = window.setInterval(refresh, 5000);
    const stop = () => { live = false; window.clearInterval(timer); socket.disconnect(); };
    socket.on('fetch-messages', refresh);
    void refresh();
    return stop;
  }, [ticket]);

  return (
    <Box p="xl" style={{ minHeight: '100vh', background: '#101828', color: 'white' }}>
      <Head><meta name="referrer" content="no-referrer" /></Head>
      <Title order={1} mb="xl">Class Discussion</Title>
      {error && <Text role="alert" c="red.3">{error}</Text>}
      <Stack gap="lg">
        {messages.map(message => (
          <Paper key={message.id} p="lg" radius="md" style={{ background: '#26364d', color: 'white' }}>
            <Text fw={700} size="lg">{message.anonymousName}</Text>
            <Text size="xl">{message.message}</Text>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
