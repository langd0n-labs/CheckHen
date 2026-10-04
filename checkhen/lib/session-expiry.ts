import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { asEvent } from './event-store';
import { foldEvents } from './events';
import { revokeSessionDevices } from './portal-binding';

/** Close elapsed sessions after access has been revoked. Safe to retry. */
export async function expireSessions(now = new Date()) {
  const sessions = await prisma.$queryRaw<{ id: string; courseId: string }[]>`
    SELECT c."id", c."courseId" FROM "Class" c
    WHERE c."createdAt" + c."duration" * INTERVAL '1 minute' <= ${now}
      AND NOT EXISTS (SELECT 1 FROM "ParticipationEvent" e
        WHERE e."courseId" = c."courseId" AND e."classId" = c."id"
          AND e."kind" = 'SESSION_ENDED')`;
  let ended = 0;
  for (const session of sessions) {
    const scope = { courseId: session.courseId, classId: session.id };
    await revokeSessionDevices(scope);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Class" WHERE "id" = ${session.id} AND "courseId" = ${session.courseId} FOR UPDATE`;
      const events = (await tx.participationEvent.findMany({ where: scope,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(asEvent);
      const state = foldEvents(events, scope);
      if (state.endedAt) return;
      let timestamp = Math.max(now.getTime(), (events.at(-1)?.createdAt.getTime() ?? 0) + 1);
      for (const attendee of state.attendance.filter(entry => entry.isPresent)) {
        await tx.participationEvent.create({ data: { id: randomUUID(), ...scope,
          userId: attendee.userId, actorId: 'system:session-expiry', kind: 'CHECK_OUT',
          payload: {}, createdAt: new Date(timestamp++) } });
      }
      await tx.participationEvent.create({ data: { id: randomUUID(), ...scope,
        userId: null, actorId: 'system:session-expiry', kind: 'SESSION_ENDED',
        payload: {}, createdAt: new Date(timestamp) } });
      ended += 1;
    });
  }
  return ended;
}
