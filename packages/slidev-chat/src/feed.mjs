// A refused ticket needs a new link from the dashboard; an unreachable server needs
// only time. The deck shows different text for each, so `kind` tells them apart.
export class ChatFeedError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export function followChat({ server, ticket, connectSocket, fetchImpl, onMessages, onError,
  interval = setInterval, clear = clearInterval }) {
  if (!server || !ticket) throw new Error('CheckHen server and projection ticket are required');
  let active = true;
  const endpoint = `${server.replace(/\/$/, '')}/api/projection/chat?ticket=${encodeURIComponent(ticket)}`;
  const refresh = async () => {
    try {
      const response = await fetchImpl(endpoint);
      if (response.status === 401 || response.status === 403)
        throw new ChatFeedError('expired', 'Projection access expired');
      if (!response.ok) throw new ChatFeedError('unavailable', `Chat server returned ${response.status}`);
      const result = await response.json();
      if (active) onMessages(result.messages.map(({ id, message, anonymousName, createdAt }) =>
        ({ id, message, anonymousName, createdAt })));
    } catch (error) {
      if (active) onError(error instanceof ChatFeedError ? error : new ChatFeedError('unavailable', String(error)));
    }
  };
  void refresh();
  const socket = connectSocket(server, { auth: { ticket } });
  socket.on('fetch-messages', refresh);
  // Socket notifications bring new messages at once; the poll is only a fallback.
  const timer = interval(refresh, 5000);
  return () => { active = false; clear(timer); socket.disconnect(); };
}
