import { scopedFetch, selectedScope } from './scoped-fetch';
import { io, Socket } from "socket.io-client";

const isBrowser = typeof window !== "undefined";

// export const socket = isBrowser ? io() : null;

export const getSocket = (classId: string): Socket | null => {
  if (!isBrowser) {
    return null;
  }
  const scope = selectedScope();
  if (!scope.courseId || scope.classId !== classId) return null;

  const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:6060';

  const socket = io(SOCKET_URL, {
    auth: async callback => {
      try {
        const response = await scopedFetch('/api/socket-ticket', { method: 'POST' });
        if (!response.ok) throw new Error('Socket ticket unavailable');
        callback({ ticket: (await response.json()).ticket });
      } catch { callback({ ticket: '' }); }
    },
  });

  return socket;
};
