/**
 * Demo mode: fictional farm-animal students, a seeded course, and sign-in as any
 * persona. A demo deployment holds only this data; it never has a real roster.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { checkhenMode } from './mode';

export const DEMO_DOMAIN = 'demo.checkhen.invalid';
export const DEMO_INSTRUCTOR = `instructor@${DEMO_DOMAIN}`;
export const DEMO_COURSE_NAME = 'Demo: Farm Science 101';

/** Demo mode runs only on a hosted deployment; classroom mode ignores CHECKHEN_DEMO. */
export function isDemo(): boolean {
  return process.env.CHECKHEN_DEMO === '1' && checkhenMode() === 'hosted';
}

export const DEMO_DATABASE_REFUSED =
  'Demo mode is off: this database holds data that is not from the demo. Use a separate database for the demo.';

/**
 * Demo mode serves only a database that holds nothing but demo data: every user has
 * a demo address, and every course with sessions or a roster came from the seed. An
 * empty course holds no data; the events migration creates one in every database.
 * Returns the refusal, or null.
 */
export async function demoDatabaseProblem(db: PrismaClient): Promise<string | null> {
  const [users, courses] = await Promise.all([
    db.user.count({ where: { NOT: { email: { endsWith: `@${DEMO_DOMAIN}` } } } }),
    db.course.count({
      where: { demo: false, OR: [{ classes: { some: {} } }, { roster: { some: {} } }] },
    }),
  ]);
  return users || courses ? DEMO_DATABASE_REFUSED : null;
}

export type Persona = { email: string; name: string; emoji: string; color: string; note: string };

/** Each student shows a pattern in the seed, so every feature has data to look at. */
export const DEMO_STUDENTS: Persona[] = [
  {
    email: `clover@${DEMO_DOMAIN}`,
    name: 'Clover the Cow',
    emoji: '🐄',
    color: '#e8f1ff',
    note: 'answers when called',
  },
  {
    email: `pepper@${DEMO_DOMAIN}`,
    name: 'Pepper the Pig',
    emoji: '🐖',
    color: '#ffe8ef',
    note: 'had a follow-up run',
  },
  {
    email: `sage@${DEMO_DOMAIN}`,
    name: 'Sage the Sheep',
    emoji: '🐑',
    color: '#f1f1f1',
    note: 'never called',
  },
  {
    email: `gus@${DEMO_DOMAIN}`,
    name: 'Gus the Goat',
    emoji: '🐐',
    color: '#f3eee4',
    note: 'passes often',
  },
  {
    email: `daisy@${DEMO_DOMAIN}`,
    name: 'Daisy the Duck',
    emoji: '🦆',
    color: '#fff6d6',
    note: 'volunteers often',
  },
  {
    email: `hank@${DEMO_DOMAIN}`,
    name: 'Hank the Horse',
    emoji: '🐎',
    color: '#f5e9df',
    note: 'had a Retry',
  },
  {
    email: `rosie@${DEMO_DOMAIN}`,
    name: 'Rosie the Rabbit',
    emoji: '🐇',
    color: '#f6eefc',
    note: 'has an excused absence',
  },
  {
    email: `lulu@${DEMO_DOMAIN}`,
    name: 'Lulu the Llama',
    emoji: '🦙',
    color: '#eaf7ee',
    note: 'answers follow-ups',
  },
  {
    email: `chip@${DEMO_DOMAIN}`,
    name: 'Chip the Rooster',
    emoji: '🐓',
    color: '#fff0e6',
    note: 'was skipped',
  },
  {
    email: `theo@${DEMO_DOMAIN}`,
    name: 'Theo the Turkey',
    emoji: '🦃',
    color: '#f7ece6',
    note: 'left early once',
  },
];
export const DEMO_INSTRUCTOR_PERSONA: Persona = {
  email: DEMO_INSTRUCTOR,
  name: 'Professor Hoot',
  emoji: '🦉',
  color: '#e6f0ff',
  note: 'the instructor',
};

/** A generated avatar: the animal on a soft circle. No image files to license. */
export function avatar(persona: Persona): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="${persona.color}"/>` +
    `<text x="50" y="66" font-size="52" text-anchor="middle">${persona.emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The demo course in force: the newest seeded one. A reset makes a new one from the seed. */
export async function currentDemoCourse(db: PrismaClient) {
  return db.course.findFirst({
    where: { demo: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** Past meetings at fixed dates (Tuesdays, 2 pm Eastern), then a live session. */
export const DEMO_MEETINGS = ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map(
  (day) => new Date(`${day}T18:00:00Z`)
);

type Seeded = {
  kind: string;
  who?: string;
  payload?: Record<string, unknown>;
  ref?: string;
  of?: string;
};

const names = [
  'Swift Panda',
  'Quiet Heron',
  'Bold Otter',
  'Calm Fox',
  'Bright Wren',
  'Keen Lynx',
  'Merry Finch',
  'Brave Seal',
  'Gentle Moose',
  'Lively Robin',
];

/**
 * Events for one past meeting. `ref` names an event so a later one can supersede it
 * (`of`), as an excuse or a follow-up does.
 */
function pastMeeting(index: number): Seeded[] {
  const checkIns: Seeded[] = DEMO_STUDENTS.filter((_, i) => !(index === 2 && i === 6)).map(
    (student, i) => ({
      kind: 'CHECK_IN',
      who: student.email,
      payload: { anonymousName: names[i], ...(i % 2 ? { rollCall: true } : {}) },
    })
  );
  const by = (key: string) => `${key}@${DEMO_DOMAIN}`;
  const call = (who: string, outcome: string, extra: Partial<Seeded> = {}): Seeded => ({
    kind: 'COLD_CALL',
    who: by(who),
    payload: { outcome, seed: 1000 + index },
    ...extra,
  });
  const meetings: Seeded[][] = [
    [
      call('clover', 'answered'),
      call('gus', 'pass'),
      call('pepper', 'answered', { ref: 'run' }),
      { kind: 'COLD_CALL', who: by('pepper'), payload: { outcome: 'answered' }, of: 'run' },
      { kind: 'COLD_CALL', who: by('pepper'), payload: { outcome: 'pass' }, of: 'run' },
      call('hank', 'retry'),
      call('chip', 'skip'),
      { kind: 'HAND_RAISED', who: by('daisy'), ref: 'hand1' },
      { kind: 'HAND_ACKNOWLEDGED', who: by('daisy'), of: 'hand1' },
    ],
    [
      call('hank', 'answered'),
      call('gus', 'pass'),
      call('rosie', 'absent', { ref: 'absent' }),
      call('lulu', 'answered'),
      { kind: 'HAND_RAISED', who: by('daisy'), ref: 'hand2' },
      { kind: 'HAND_ACKNOWLEDGED', who: by('daisy'), of: 'hand2' },
      {
        kind: 'COLD_CALL_EXCUSED',
        who: by('rosie'),
        payload: { reason: 'At the vet' },
        of: 'absent',
      },
    ],
    [
      call('gus', 'answered'),
      call('theo', 'absent'),
      call('clover', 'answered'),
      call('pepper', 'pass'),
      { kind: 'HAND_RAISED', who: by('daisy'), ref: 'hand3' },
      { kind: 'HAND_ACKNOWLEDGED', who: by('daisy'), of: 'hand3' },
    ],
    [
      call('gus', 'pass'),
      call('lulu', 'answered', { ref: 'run2' }),
      { kind: 'COLD_CALL', who: by('lulu'), payload: { outcome: 'answered' }, of: 'run2' },
      call('hank', 'answered'),
      call('rosie', 'answered'),
    ],
  ];
  return [
    ...checkIns,
    {
      kind: 'CHAT_MESSAGE',
      who: by('clover'),
      payload: { message: 'Is milk yield a continuous variable?', anonymousName: names[0] },
    },
    { kind: 'PACE_SIGNAL', who: by('gus'), payload: { signalType: 'slow_down' } },
    { kind: 'PACE_SIGNAL', who: by('daisy'), payload: { signalType: 'ready_to_move_on' } },
    ...meetings[index],
    { kind: 'SESSION_ENDED' },
  ];
}

/**
 * Create a fresh demo course from the seed. The event log is append-only, so a
 * reset never deletes: it makes a new course, and the newest one is the demo.
 */
export async function seedDemo(db: PrismaClient, now = new Date()) {
  const personas = [DEMO_INSTRUCTOR_PERSONA, ...DEMO_STUDENTS];
  const users = new Map<string, string>();
  for (const persona of personas) {
    const profile = {
      displayName: persona.name,
      profilePicture: avatar(persona),
      pronouns: 'they/them',
      namePronunciation: null,
      foodAllergies: null,
      bio: null,
      isAdmin: persona.email === DEMO_INSTRUCTOR,
    };
    const user = await db.user.upsert({
      where: { email: persona.email },
      // A reset restores every profile field a visitor could have changed.
      update: profile,
      create: { email: persona.email, ...profile },
    });
    users.set(persona.email, user.id);
  }
  const course = await db.course.create({ data: { name: DEMO_COURSE_NAME, demo: true } });
  await db.rosterEntry.createMany({
    data: DEMO_STUDENTS.map((student) => ({
      courseId: course.id,
      userId: users.get(student.email)!,
    })),
  });
  const instructor = users.get(DEMO_INSTRUCTOR)!;
  const write = async (classId: string, start: Date, events: Seeded[]) => {
    const ids = new Map<string, string>();
    let minute = 0;
    for (const seeded of events) {
      const id = randomUUID();
      const target = seeded.of ? ids.get(seeded.of) : undefined;
      const payload =
        seeded.kind === 'HAND_ACKNOWLEDGED'
          ? { handRaiseId: target }
          : seeded.kind === 'COLD_CALL' && seeded.of
            ? { ...seeded.payload, followUpOf: target }
            : (seeded.payload ?? {});
      await db.participationEvent.create({
        data: {
          id,
          courseId: course.id,
          classId,
          userId: seeded.who ? users.get(seeded.who)! : null,
          actorId:
            seeded.kind.startsWith('COLD_CALL') || seeded.kind === 'HAND_ACKNOWLEDGED'
              ? instructor
              : seeded.who
                ? users.get(seeded.who)!
                : instructor,
          kind: seeded.kind,
          payload: payload as Prisma.InputJsonObject,
          createdAt: new Date(start.getTime() + (minute += 1) * 60000),
          // Only an excuse supersedes; follow-ups and acknowledgements point by payload.
          supersedesId: seeded.kind === 'COLD_CALL_EXCUSED' ? target : null,
        },
      });
      if (seeded.ref) {
        ids.set(seeded.ref, id);
      }
    }
  };
  for (let index = 0; index < DEMO_MEETINGS.length; index += 1) {
    const start = DEMO_MEETINGS[index];
    const session = await db.class.create({
      data: { courseId: course.id, name: `Week ${index + 1}`, duration: 75, createdAt: start },
    });
    await write(session.id, start, pastMeeting(index));
  }
  // A live session for trying every screen: a week long, everyone checked in. It
  // starts a little in the past so its seeded events never carry future times.
  const liveStart = new Date(now.getTime() - 15 * 60000);
  const live = await db.class.create({
    data: {
      courseId: course.id,
      name: 'Live demo session',
      duration: 7 * 24 * 60,
      createdAt: liveStart,
    },
  });
  await write(live.id, liveStart, [
    ...DEMO_STUDENTS.map((student, i) => ({
      kind: 'CHECK_IN',
      who: student.email,
      payload: { anonymousName: names[i], rollCall: true },
    })),
    {
      kind: 'CHAT_MESSAGE',
      who: DEMO_STUDENTS[3].email,
      payload: { message: 'Can goats be a control group?', anonymousName: names[3] },
    },
  ]);
  return { courseId: course.id, liveClassId: live.id };
}
