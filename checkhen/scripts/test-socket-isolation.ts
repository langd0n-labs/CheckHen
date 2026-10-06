import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';
import { readState } from '../lib/event-store';

if (
  new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid').pathname !==
  '/checkhen_test'
) {
  throw new Error('Use the disposable checkhen_test database');
}
const secret = process.env.TEST_AUTH_SECRET || '';
if (!secret) throw new Error('Set a non-production TEST_AUTH_SECRET');
const db = new PrismaClient();
async function main() {
  const heartbeatRequests: { body: string; signature: string | undefined }[] = [];
  const agent = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.url === '/exam-heartbeat')
      heartbeatRequests.push({
        body: Buffer.concat(chunks).toString(),
        signature: request.headers['x-checkhen-signature'] as string | undefined,
      });
    response.writeHead(200).end('{}');
  });
  await new Promise<void>((resolve) =>
    agent.listen(Number(process.env.TEST_EXAM_AGENT_PORT || 7879), '127.0.0.1', resolve)
  );
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: 'socket-' + suffix + '@test.example' } });
  const courseA = await db.course.create({ data: { name: 'Socket course A' } });
  const courseB = await db.course.create({ data: { name: 'Socket course B' } });
  await db.rosterEntry.createMany({
    data: [
      { courseId: courseA.id, userId: user.id, active: true },
      { courseId: courseB.id, userId: user.id, active: true },
    ],
  });
  const a = await db.class.create({ data: { courseId: courseA.id, name: 'A', duration: 60 } });
  const b = await db.class.create({ data: { courseId: courseB.id, name: 'B', duration: 60 } });
  const ticket = (courseId: string, classId: string) => {
    const payload = Buffer.from(
      JSON.stringify({
        courseId,
        classId,
        userId: user.id,
        admin: false,
        expires: Date.now() + 60000,
      })
    ).toString('base64url');
    return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
  };
  const url = process.env.TEST_SOCKET_URL || 'http://localhost:6061';
  const first = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseA.id, a.id) } });
  const second = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseB.id, b.id) } });
  // The same student on a second device in the same session.
  const twin = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseA.id, a.id) } });
  const projectionPayload = Buffer.from(
    JSON.stringify({
      courseId: courseA.id,
      classId: a.id,
      projection: true,
      expires: Date.now() + 60000,
    })
  ).toString('base64url');
  const projectionTicket =
    projectionPayload +
    '.' +
    createHmac('sha256', secret).update(projectionPayload).digest('base64url');
  const projection = io(url, { transports: ['websocket'], auth: { ticket: projectionTicket } });
  const connected = (socket: ReturnType<typeof io>) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  try {
    await Promise.all([
      connected(first),
      connected(second),
      connected(twin),
      connected(projection),
    ]);
    first.emit('exam-heartbeat', { userId: 'forged', courseId: courseB.id, classId: b.id });
    projection.emit('exam-heartbeat');
    for (let retry = 0; retry < 30 && heartbeatRequests.length === 0; retry += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(heartbeatRequests.length, 1);
    assert.deepEqual(JSON.parse(heartbeatRequests[0].body), {
      courseId: courseA.id,
      classId: a.id,
      userId: user.id,
      timestamp: JSON.parse(heartbeatRequests[0].body).timestamp,
    });
    assert.equal(
      heartbeatRequests[0].signature,
      createHmac('sha256', secret).update(heartbeatRequests[0].body).digest('hex')
    );
    // A burst from one student within the interval is not forwarded to the agent.
    for (let burst = 0; burst < 5; burst += 1) first.emit('exam-heartbeat');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(heartbeatRequests.length, 1);
    // After the interval, two sockets of one student together forward one heartbeat:
    // the limit is per student, not per socket.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    for (let burst = 0; burst < 3; burst += 1) {
      first.emit('exam-heartbeat');
      twin.emit('exam-heartbeat');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(heartbeatRequests.length, 2);
    let aEvents = 0;
    let bEvents = 0;
    first.on('fetch-messages', () => {
      aEvents += 1;
    });
    second.on('fetch-messages', () => {
      bEvents += 1;
    });
    let projectionEvents = 0;
    projection.on('fetch-messages', () => {
      projectionEvents += 1;
    });
    let resetEvents = 0;
    second.on('pace-signals-reset', () => {
      resetEvents += 1;
    });
    first.emit('chat-message-sent', { classId: b.id, courseId: courseB.id });
    first.emit('pace-signals-reset', { classId: b.id, courseId: courseB.id });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(aEvents, 0);
    assert.equal(bEvents, 0);
    assert.equal(projectionEvents, 0);
    assert.equal(resetEvents, 0);
    const message = await db.participationEvent.create({
      data: {
        courseId: courseA.id,
        classId: a.id,
        userId: user.id,
        actorId: user.id,
        kind: 'CHAT_MESSAGE',
        payload: { message: 'Persisted', anonymousName: 'Swift Panda' },
      },
    });
    for (let retry = 0; retry < 30 && aEvents === 0; retry += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(aEvents, 1);
    assert.equal(bEvents, 0);
    assert.equal(projectionEvents, 1);
    const hideAt = Date.now();
    await db.participationEvent.create({
      data: {
        courseId: courseA.id,
        classId: a.id,
        userId: user.id,
        actorId: 'instructor',
        kind: 'CHAT_HIDDEN',
        payload: { messageId: message.id },
        supersedesId: message.id,
        createdAt: new Date(Math.max(Date.now(), message.createdAt.getTime() + 1)),
      },
    });
    for (let retry = 0; retry < 20 && projectionEvents < 2; retry += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(projectionEvents, 2);
    assert.ok(Date.now() - hideAt < 1000, 'projection hide notification exceeded one second');
    assert.deepEqual((await readState(db, { courseId: courseA.id, classId: a.id })).messages, []);
    const attacker = io(url, {
      transports: ['websocket'],
      auth: { ticket: ticket(courseA.id, b.id) },
      reconnection: false,
    });
    const denied = await new Promise<boolean>((resolve) => {
      attacker.once('connect_error', () => resolve(true));
      attacker.once('connect', () => resolve(false));
    });
    attacker.disconnect();
    assert.equal(denied, true);
    await db.rosterEntry.update({
      where: { courseId_userId: { courseId: courseB.id, userId: user.id } },
      data: { active: false },
    });
    const inactive = io(url, {
      transports: ['websocket'],
      auth: { ticket: ticket(courseB.id, b.id) },
      reconnection: false,
    });
    const rosterDenied = await new Promise<boolean>((resolve) => {
      inactive.once('connect_error', () => resolve(true));
      inactive.once('connect', () => resolve(false));
    });
    inactive.disconnect();
    assert.equal(rosterDenied, true);
    console.log(
      'PASS: persisted socket events, signed scoped exam heartbeat, anonymous projection hide latency, forged relay rejection, and roster isolation'
    );
  } finally {
    first.disconnect();
    second.disconnect();
    twin.disconnect();
    projection.disconnect();
    await new Promise<void>((resolve, reject) =>
      agent.close((error) => (error ? reject(error) : resolve()))
    );
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
