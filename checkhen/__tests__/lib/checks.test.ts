import { anotherExampleShare, openCheck, tally } from '@/lib/checks';
import { configProblem, DEFAULT_CONFIG, type Meeting } from '@/lib/cold-call';
import { courseReport, sessionsCsv, studentsCsv } from '@/lib/course-report';
import { validatePayload } from '@/lib/event-store';
import { foldEvents, type ParticipationEvent } from '@/lib/events';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

let clock = 0;
function event(
  classId: string,
  userId: string | null,
  kind: ParticipationEvent['kind'],
  payload: Record<string, unknown> = {},
  at?: number
): ParticipationEvent {
  clock += 1;
  return {
    id: `e${String(clock).padStart(4, '0')}`,
    courseId: 'course',
    classId,
    userId,
    kind,
    payload,
    createdAt: new Date((at ?? clock) * 1000),
    supersedesId: null,
  };
}
const choices = ['got_it', 'another_example'];
const opened = (classId: string, checkId: string, at: number, closesAt: number | null = null) =>
  event(
    classId,
    null,
    'CHECK_OPENED',
    {
      checkId,
      kind: 'understanding',
      choices,
      closesAt: closesAt === null ? null : new Date(closesAt * 1000).toISOString(),
    },
    at
  );
const answered = (classId: string, userId: string, checkId: string, choice: string, at: number) =>
  event(classId, userId, 'CHECK_ANSWERED', { checkId, choice }, at);
const here = (classId: string, userId: string, at: number) =>
  event(classId, userId, 'CHECK_IN', { anonymousName: userId }, at);
const scope = (classId: string) => ({ courseId: 'course', classId });

describe('the check fold', () => {
  it('counts each student once, by their latest answer while open', () => {
    const events = [
      here('m', 'a', 1),
      here('m', 'b', 2),
      opened('m', 'k', 3, 100),
      answered('m', 'a', 'k', 'another_example', 4),
      answered('m', 'a', 'k', 'got_it', 5),
      answered('m', 'b', 'k', 'another_example', 6),
      answered('m', 'b', 'k', 'not-a-choice', 7),
    ];
    const [check] = foldEvents(events, scope('m')).checks;
    expect(check.present).toEqual(['a', 'b']);
    expect(tally(check)).toEqual({ got_it: 1, another_example: 1 });
    expect(anotherExampleShare(check)).toBe(0.5);
    expect(openCheck([check], new Date(50_000))).toBe(check);
    expect(openCheck([check], new Date(100_000))).toBeNull();
  });

  it('ignores answers after the timer, a close, or the end of the session', () => {
    const timed = foldEvents(
      [here('m', 'a', 1), opened('m', 'k', 2, 10), answered('m', 'a', 'k', 'got_it', 11)],
      scope('m')
    ).checks[0];
    expect(timed.answers).toEqual([]);
    const closed = foldEvents(
      [
        here('m', 'a', 1),
        opened('m', 'k', 2),
        event('m', null, 'CHECK_CLOSED', { checkId: 'k' }, 3),
        answered('m', 'a', 'k', 'got_it', 4),
      ],
      scope('m')
    ).checks[0];
    expect(closed.closedAt).toEqual(new Date(3000));
    expect(closed.answers).toEqual([]);
    const ended = foldEvents(
      [here('m', 'a', 1), opened('m', 'k', 2), event('m', null, 'SESSION_ENDED', {}, 3)],
      scope('m')
    ).checks[0];
    expect(ended.closedAt).toEqual(new Date(3000));
  });
});

describe('check payloads', () => {
  const valid = { checkId: 'k', kind: 'understanding', choices, closesAt: null };
  it('accepts an understanding check with or without a timer, label, or slide', () => {
    expect(() => validatePayload('CHECK_OPENED', valid)).not.toThrow();
    expect(() =>
      validatePayload('CHECK_OPENED', {
        ...valid,
        label: 'Sampling',
        slide: 17,
        closesAt: new Date().toISOString(),
      })
    ).not.toThrow();
  });
  it('refuses unknown kinds, bad choices, timers, and long labels', () => {
    expect(() => validatePayload('CHECK_OPENED', { ...valid, kind: 'poll' })).toThrow();
    expect(() => validatePayload('CHECK_OPENED', { ...valid, choices: ['only'] })).toThrow();
    expect(() => validatePayload('CHECK_OPENED', { ...valid, closesAt: 'soon' })).toThrow();
    expect(() => validatePayload('CHECK_OPENED', { ...valid, label: 'x'.repeat(101) })).toThrow();
    expect(() => validatePayload('CHECK_ANSWERED', { checkId: 'k' })).toThrow();
    expect(() => validatePayload('CHECK_CLOSED', {})).toThrow();
  });
});

describe('check settings', () => {
  it('needs a threshold above 0 and at most 1, and a whole window of at least 1', () => {
    expect(configProblem({ ...DEFAULT_CONFIG, check_threshold: 0 })).toMatch(/another example/);
    expect(configProblem({ ...DEFAULT_CONFIG, check_threshold: 1.5 })).toMatch(/another example/);
    expect(configProblem({ ...DEFAULT_CONFIG, check_window: 0 })).toMatch(/trend/);
    expect(configProblem({ ...DEFAULT_CONFIG, check_window: 2.5 })).toMatch(/trend/);
    expect(configProblem(DEFAULT_CONFIG)).toBeNull();
  });
});

describe('checks in the course record', () => {
  const roster = [
    { userId: 'a', name: 'Ada', email: 'ada@example.edu' },
    { userId: 'b', name: 'Ben', email: 'ben@example.edu' },
    { userId: 'c', name: 'Cal', email: 'cal@example.edu' },
    { userId: 'd', name: 'Dee', email: 'dee@example.edu' },
  ];
  // Lecture n: one check where `another` of four students ask for another example.
  const lecture = (n: number, another: number): Meeting => {
    const classId = `m${n}`;
    const base = n * 1000;
    return {
      courseId: 'course',
      classId,
      events: [
        ...roster.map((student, i) => here(classId, student.userId, base + i)),
        opened(classId, `k${n}`, base + 10),
        ...roster.map((student, i) =>
          answered(
            classId,
            student.userId,
            `k${n}`,
            i < another ? 'another_example' : 'got_it',
            base + 11 + i
          )
        ),
      ],
    };
  };
  const build = (meetings: Meeting[], config = DEFAULT_CONFIG) =>
    courseReport(
      meetings,
      meetings.map((meeting) => ({
        classId: meeting.classId,
        name: meeting.classId,
        startedAt: new Date(),
      })),
      roster,
      config
    );

  it('counts a lecture as needing another example at the threshold share of answers', () => {
    // 25% is one of four answers: lecture 2 counts, lecture 1 does not.
    const report = build([lecture(1, 0), lecture(2, 1), lecture(3, 2)]);
    expect(report.checks.map((row) => row.needsExample)).toEqual([false, true, true]);
    expect(report.checks[1]).toMatchObject({
      present: 4,
      answered: 4,
      gotIt: 3,
      anotherExample: 1,
    });
    expect(report.checkTrend).toEqual({
      lectures: 3,
      needingExample: 2,
      threshold: 0.25,
      window: 6,
    });
    expect(report.students.every((student) => student.checksAnswered === 3)).toBe(true);
  });

  it('covers only the latest lectures with checks, skipping lectures without one', () => {
    const empty: Meeting = { courseId: 'course', classId: 'm9', events: [here('m9', 'a', 9000)] };
    const report = build([lecture(1, 4), lecture(2, 0), empty, lecture(3, 0)], {
      ...DEFAULT_CONFIG,
      check_window: 2,
    });
    expect(report.checkTrend).toMatchObject({ lectures: 2, needingExample: 0 });
  });

  it('exports check counts in both CSVs', () => {
    const report = build([lecture(1, 2)]);
    const sessions = sessionsCsv(report, DEFAULT_CONFIG, new Date(0)).split('\r\n');
    const header = sessions[0].split(',');
    const row = sessions[1].split(',');
    expect(row[header.indexOf('checks')]).toBe('1');
    expect(row[header.indexOf('checks_needing_example')]).toBe('1');
    const students = studentsCsv(report, DEFAULT_CONFIG, new Date(0)).split('\r\n');
    expect(students[1].split(',')[students[0].split(',').indexOf('checks_answered')]).toBe('1');
  });
});
