/**
 * Reproducible M2 load test for authenticated Socket.IO chat notifications.
 *
 * Required environment:
 *   DATABASE_URL       disposable database whose name is checkhen_test
 *   AUTH_SECRET        same value as the running test socket server
 *
 * Optional environment:
 *   TEST_SOCKET_URL    default http://localhost:6060
 *   TEST_CLIENTS       default 150 (capped at 150 for the acceptance check)
 */
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';

const databaseUrl = process.env.DATABASE_URL || '';
if (new URL(databaseUrl || 'postgresql://localhost/invalid').pathname !== '/checkhen_test') {
  throw new Error('Use the disposable checkhen_test database');
}
const secret = process.env.AUTH_SECRET || '';
if (!secret) {
  throw new Error('Set AUTH_SECRET; its value is not printed');
}

const socketUrl = process.env.TEST_SOCKET_URL || 'http://localhost:6060';
const clientCount = Number(process.env.TEST_CLIENTS || 150);
if (!Number.isInteger(clientCount) || clientCount < 1 || clientCount > 150) {
  throw new Error('TEST_CLIENTS must be an integer from 1 through 150');
}

const db = new PrismaClient();
const sockets: Socket[] = [];
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const ticket = (courseId: string, classId: string, userId: string) => {
  const payload = Buffer.from(
    JSON.stringify({ courseId, classId, userId, admin: false, expires: Date.now() + 120_000 })
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

async function main() {
  const token = randomUUID();
  const course = await db.course.create({ data: { name: `[LOAD TEST] ${token}` } });
  const session = await db.class.create({
    data: { courseId: course.id, name: '[LOAD TEST] session', duration: 10 },
  });
  const users = await Promise.all(
    Array.from({ length: clientCount }, (_, n) =>
      db.user.create({
        data: { email: `load-${token}-${n}@test.example` },
      })
    )
  );
  await db.rosterEntry.createMany({
    data: users.map((user) => ({ courseId: course.id, userId: user.id, active: true })),
  });
  const anonymousNames = users.map((_, n) => `Load Test ${n}`);
  await db.participationEvent.createMany({
    data: users.map((user, n) => ({
      courseId: course.id,
      classId: session.id,
      userId: user.id,
      actorId: user.id,
      kind: 'CHECK_IN',
      payload: { anonymousName: anonymousNames[n] },
    })),
  });

  try {
    for (const user of users) {
      const socket = io(socketUrl, {
        transports: ['websocket'],
        reconnection: false,
        auth: { ticket: ticket(course.id, session.id, user.id) },
      });
      sockets.push(socket);
    }
    await Promise.all(sockets.map(connected));

    const timings: number[] = [];
    let started = 0;
    const notification = new Promise<void>((resolve) => {
      let received = 0;
      for (const socket of sockets) {
        socket.once('fetch-messages', () => {
          timings.push(performance.now() - started);
          received += 1;
          if (received === sockets.length) {
            resolve();
          }
        });
      }
    });
    started = performance.now();
    const message = await db.participationEvent.create({
      data: {
        courseId: course.id,
        classId: session.id,
        userId: users[0].id,
        actorId: users[0].id,
        kind: 'CHAT_MESSAGE',
        payload: { message: `M2 load test ${token}`, anonymousName: anonymousNames[0] },
      },
    });
    const writeMs = performance.now() - started;
    sockets[0].emit('chat-message-sent', {
      classId: session.id,
      courseId: course.id,
      id: message.id,
    });
    await Promise.race([
      notification,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Only ${timings.length}/${sockets.length} clients received the notification within 10 seconds`
              )
            ),
          10_000
        )
      ),
    ]);

    const median = percentile(timings, 0.5);
    const failures = clientCount - timings.length;
    console.log(
      JSON.stringify({
        clients: clientCount,
        connected: sockets.length,
        writeMs: Number(writeMs.toFixed(1)),
        chatMedianMs: Number(median.toFixed(1)),
        failures,
        courseId: course.id,
        classId: session.id,
      })
    );
    if (median >= 1000 || failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'load test failed');
  process.exitCode = 1;
});
