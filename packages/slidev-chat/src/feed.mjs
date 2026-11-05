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
  // Only the newest request may report; a refused ticket never works again, so the
  // feed stops after one.
  let latest = 0;
  const endpoint = `${server.replace(/\/$/, '')}/api/projection/chat?ticket=${encodeURIComponent(ticket)}`;
  const refresh = async () => {
    const request = ++latest;
    try {
      const response = await fetchImpl(endpoint);
      if (!active || request !== latest) return;
      if (response.status === 401 || response.status === 403) {
        stop();
        onError(new ChatFeedError('expired', 'Projection access expired'));
        return;
      }
      if (!response.ok) throw new ChatFeedError('unavailable', `Chat server returned ${response.status}`);
      const result = await response.json();
      if (active && request === latest) onMessages(result.messages.map(({ id, message, anonymousName, createdAt }) =>
        ({ id, message, anonymousName, createdAt })));
    } catch (error) {
      if (active && request === latest)
        onError(error instanceof ChatFeedError ? error : new ChatFeedError('unavailable', String(error)));
    }
  };
  const socket = connectSocket(server, { auth: { ticket } });
  // Socket notifications bring new messages at once; the poll is only a fallback.
  const timer = interval(refresh, 5000);
  const stop = () => { active = false; clear(timer); socket.disconnect(); };
  socket.on('fetch-messages', refresh);
  void refresh();
  return stop;
}
