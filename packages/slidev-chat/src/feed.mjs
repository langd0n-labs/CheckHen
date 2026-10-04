export function followChat({ server, ticket, connectSocket, fetchImpl, onMessages, onError,
  interval = setInterval, clear = clearInterval }) {
  if (!server || !ticket) throw new Error('CheckHen server and projection ticket are required');
  let active = true;
  const endpoint = `${server.replace(/\/$/, '')}/api/projection/chat?ticket=${encodeURIComponent(ticket)}`;
  const refresh = async () => {
    try {
      const response = await fetchImpl(endpoint);
      if (!response.ok) throw new Error('Projection access expired');
      const result = await response.json();
      if (active) onMessages(result.messages.map(({ id, message, anonymousName, createdAt }) =>
        ({ id, message, anonymousName, createdAt })));
    } catch (error) { if (active) onError(error); }
  };
  void refresh();
  const socket = connectSocket(server, { auth: { ticket } });
  socket.on('fetch-messages', refresh);
  const timer = interval(refresh, 500);
  return () => { active = false; clear(timer); socket.disconnect(); };
}
