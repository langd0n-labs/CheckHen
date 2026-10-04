import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

if (new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid').pathname !== '/checkhen_test') {
  throw new Error('Use the disposable checkhen_test database');
}
const secret = process.env.TEST_AUTH_SECRET || '';
if (!secret) throw new Error('Set a non-production TEST_AUTH_SECRET');
const db = new PrismaClient();
async function main() {
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: 'socket-' + suffix + '@test.example' } });
  const courseA = await db.course.create({ data: { name: 'Socket course A' } });
  const courseB = await db.course.create({ data: { name: 'Socket course B' } });
  await db.rosterEntry.createMany({ data: [
    { courseId: courseA.id, userId: user.id, active: true },
    { courseId: courseB.id, userId: user.id, active: true },
  ] });
  const a = await db.class.create({ data: { courseId: courseA.id, name: 'A', duration: 60 } });
  const b = await db.class.create({ data: { courseId: courseB.id, name: 'B', duration: 60 } });
  const ticket = (courseId: string, classId: string) => {
    const payload = Buffer.from(JSON.stringify({ courseId, classId, userId: user.id, admin: false, expires: Date.now() + 60000 })).toString('base64url');
    return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
  };
  const url = process.env.TEST_SOCKET_URL || 'http://localhost:6061';
  const first = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseA.id, a.id) } });
  const second = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseB.id, b.id) } });
  const connected = (socket: ReturnType<typeof io>) => new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  try {
    await Promise.all([connected(first), connected(second)]);
    let aEvents = 0;
    let bEvents = 0;
    first.on('fetch-messages', () => { aEvents += 1; });
    second.on('fetch-messages', () => { bEvents += 1; });
    let resetEvents = 0;
    second.on('pace-signals-reset', () => { resetEvents += 1; });
    first.emit('chat-message-sent', { classId: b.id, courseId: courseB.id });
    first.emit('pace-signals-reset', { classId: b.id, courseId: courseB.id });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(aEvents, 0);
    assert.equal(bEvents, 0);
    assert.equal(resetEvents, 0);
    await db.participationEvent.create({ data: { courseId: courseA.id, classId: a.id,
      userId: user.id, actorId: user.id, kind: 'CHAT_MESSAGE',
      payload: { message: 'Persisted', anonymousName: 'Swift Panda' } } });
    for (let retry = 0; retry < 30 && aEvents === 0; retry += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(aEvents, 1);
    assert.equal(bEvents, 0);
    const attacker = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseA.id, b.id) }, reconnection: false });
    const denied = await new Promise<boolean>(resolve => {
      attacker.once('connect_error', () => resolve(true));
      attacker.once('connect', () => resolve(false));
    });
    attacker.disconnect();
    assert.equal(denied, true);
    await db.rosterEntry.update({
      where: { courseId_userId: { courseId: courseB.id, userId: user.id } },
      data: { active: false },
    });
    const inactive = io(url, { transports: ['websocket'], auth: { ticket: ticket(courseB.id, b.id) }, reconnection: false });
    const rosterDenied = await new Promise<boolean>(resolve => {
      inactive.once('connect_error', () => resolve(true));
      inactive.once('connect', () => resolve(false));
    });
    inactive.disconnect();
    assert.equal(rosterDenied, true);
    console.log('PASS: sockets broadcast only persisted events and reject forged relays, mismatched tickets, and inactive rosters');
  } finally {
    first.disconnect();
    second.disconnect();
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
