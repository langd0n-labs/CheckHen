import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readEvents, readState } from '../lib/event-store';

if (new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid').pathname !== '/checkhen_legacy_test') {
  throw new Error('Use the disposable checkhen_legacy_test database');
}
const db = new PrismaClient();
async function main() {
  const scope = { courseId: 'imported-course', classId: 'legacy-class' };
  const [legacyClass, template, oldCheckIn, user, roster] = await Promise.all([
    db.class.findUniqueOrThrow({ where: { id: scope.classId } }),
    db.classTemplate.findUniqueOrThrow({ where: { id: 'legacy-template' } }),
    db.checkIn.findUniqueOrThrow({ where: { id: 'legacy-checkin' } }),
    db.user.findUniqueOrThrow({ where: { id: 'legacy-student' } }),
    db.rosterEntry.findUniqueOrThrow({ where: { courseId_userId: { courseId: scope.courseId, userId: 'legacy-student' } } }),
  ]);
  assert.equal(legacyClass.courseId, scope.courseId);
  assert.equal(template.courseId, scope.courseId);
  assert.equal(roster.active, true);
  assert.equal(user.foodAllergies, 'peanuts');
  assert.equal(user.bio, 'Test bio');
  assert.equal(oldCheckIn.anonymousName, 'Swift Panda');
  const events = await readEvents(db, scope);
  assert.equal(events.length, 7);
  const state = await readState(db, scope);
  assert.deepEqual(state.attendance.map(e => [e.anonymousName, e.isPresent]), [['Swift Panda', false]]);
  assert.deepEqual(state.hands.map(e => [e.isAcknowledged, e.isRated, e.hasValue]), [[true, true, true]]);
  assert.equal(state.pace[0].signalType, 'slow_down');
  assert.equal(state.messages[0].message, 'Old question');
  await assert.rejects(db.checkIn.update({ where: { id: 'legacy-checkin' }, data: { isPresent: true } }));
  console.log('PASS: migration retains legacy records, profiles, course scope, and folded state');
}
main().finally(() => db.$disconnect());
