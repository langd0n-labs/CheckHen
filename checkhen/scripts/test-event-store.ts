import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { appendEvent, readEvents, readState } from '../lib/event-store';

if (!process.env.DATABASE_URL?.includes('/checkhen_test')) {
  throw new Error('Use a disposable database named checkhen_test');
}
const db = new PrismaClient();
async function main() {
  const suffix = randomUUID();
  const student = await db.user.create({ data: { email: 'student-' + suffix + '@example.edu' } });
  const a = await db.course.create({ data: { name: 'Course A' } });
  const b = await db.course.create({ data: { name: 'Course B' } });
  await db.rosterEntry.createMany({ data: [
    { courseId: a.id, userId: student.id }, { courseId: b.id, userId: student.id },
  ] });
  const sa = await db.class.create({ data: { courseId: a.id, name: 'Session A', duration: 60 } });
  const sb = await db.class.create({ data: { courseId: b.id, name: 'Session B', duration: 60 } });
  const scopeA = { courseId: a.id, classId: sa.id };
  const scopeB = { courseId: b.id, classId: sb.id };
  const identity = { userId: student.id, actorId: student.id };
  await Promise.all([
    appendEvent(db, { ...scopeA, ...identity, kind: 'CHECK_IN', payload: { anonymousName: 'Swift Panda' } }),
    appendEvent(db, { ...scopeB, ...identity, kind: 'CHECK_IN', payload: { anonymousName: 'Calm Otter' } }),
  ]);
  assert.equal((await readState(db, scopeA)).attendance[0].anonymousName, 'Swift Panda');
  assert.equal((await readState(db, scopeB)).attendance[0].anonymousName, 'Calm Otter');
  await assert.rejects(appendEvent(db, { courseId: b.id, classId: sa.id, ...identity, kind: 'CHECK_OUT' }));
  const original = await appendEvent(db, { ...scopeA, ...identity, kind: 'PACE_SIGNAL', payload: { signalType: 'slow_down' } });
  const correction = await appendEvent(db, { ...scopeA, ...identity, kind: 'PACE_SIGNAL', payload: { signalType: 'ready_to_move_on' }, supersedesId: original.id });
  assert.equal((await readState(db, scopeA)).pace[0].signalType, 'ready_to_move_on');
  const undo = await appendEvent(db, { ...scopeA, actorId: student.id, kind: 'UNDO', supersedesId: correction.id });
  assert.equal((await readState(db, scopeA)).pace[0].signalType, 'slow_down');
  await appendEvent(db, { ...scopeA, actorId: student.id, kind: 'UNDO', supersedesId: undo.id });
  assert.equal((await readState(db, scopeA)).pace[0].signalType, 'ready_to_move_on');
  assert.equal((await readState(db, scopeB)).pace.length, 0);
  assert.equal((await readEvents(db, scopeA)).length, 5);
  assert.deepEqual((await db.participationEvent.findUniqueOrThrow({ where: { id: original.id } })).payload, { signalType: 'slow_down' });
  await assert.rejects(appendEvent(db, { ...scopeB, actorId: student.id, kind: 'UNDO', supersedesId: original.id }));
  await assert.rejects(db.participationEvent.update({ where: { id: original.id }, data: { kind: 'CHECK_OUT' } }));
  await assert.rejects(db.participationEvent.delete({ where: { id: original.id } }));
  await assert.rejects(db.$executeRawUnsafe('TRUNCATE TABLE "ParticipationEvent" CASCADE'));
  const concurrent = await Promise.all(Array.from({ length: 12 }, () =>
    appendEvent(db, { ...scopeA, ...identity, kind: 'HAND_RAISED' })));
  assert.equal(new Set(concurrent.map(e => e.createdAt.getTime())).size, 12);
  console.log('PASS: parallel course isolation, correction/undo folding, original facts retained, database immutability, concurrent append ordering');
}
main().finally(() => db.$disconnect());
