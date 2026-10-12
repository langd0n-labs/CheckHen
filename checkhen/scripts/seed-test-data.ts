/** Populate a disposable checkhen_test database with event-sourced class data. */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { generateUniqueAnonymousName } from '../lib/anonymousNames';

if (new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid').pathname !== '/checkhen_test') {
  throw new Error('Seed only a disposable checkhen_test database');
}
const db = new PrismaClient();
const count = Math.max(1, Math.min(100, Number(process.argv.find(arg => arg.startsWith('--students='))?.split('=')[1] || 30)));
const meetings = Math.max(1, Math.min(30, Number(process.argv.find(arg => arg.startsWith('--sessions='))?.split('=')[1] || 1)));

async function main() {
  const token = randomUUID();
  const course = await db.course.create({ data: { name: '[TEST] CS101 ' + token } });
  const users = await Promise.all(Array.from({ length: count }, (_, n) => db.user.create({
    data: { email: 'student-' + token + '-' + n + '@test.example' },
  })));
  await db.rosterEntry.createMany({ data: users.map(user => ({ courseId: course.id, userId: user.id })) });
  for (let n = 0; n < meetings; n += 1) {
    const cls = await db.class.create({ data: { courseId: course.id, name: '[TEST] Meeting ' + (n + 1), duration: 75 } });
    const names: string[] = [];
    for (const user of users) {
      const anonymousName = generateUniqueAnonymousName(names);
      names.push(anonymousName);
      await db.participationEvent.createMany({ data: [
        { courseId: course.id, classId: cls.id, userId: user.id, actorId: 'test-seed',
          kind: 'CHECK_IN', payload: { anonymousName } },
        { courseId: course.id, classId: cls.id, userId: user.id, actorId: 'test-seed',
          kind: 'CHAT_MESSAGE', payload: { message: 'Test question', anonymousName },
          createdAt: new Date(Date.now() + 1) },
      ] });
    }
  }
  console.log('Seeded course ' + course.id + ' with ' + meetings + ' sessions and ' + count + ' students.');
}
main().finally(() => db.$disconnect());
