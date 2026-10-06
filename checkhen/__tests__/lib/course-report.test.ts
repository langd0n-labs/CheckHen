import { DEFAULT_CONFIG, type Meeting } from '@/lib/cold-call';
import { courseReport, sessionsCsv, studentsCsv, toCsv } from '@/lib/course-report';
import type { ParticipationEvent } from '@/lib/events';

let clock = 0;
function event(
  classId: string,
  userId: string | null,
  kind: ParticipationEvent['kind'],
  payload: Record<string, unknown> = {},
  supersedesId: string | null = null
): ParticipationEvent {
  clock += 1;
  return {
    id: `e${String(clock).padStart(4, '0')}`,
    courseId: 'course',
    classId,
    userId,
    kind,
    payload,
    createdAt: new Date(clock * 1000),
    supersedesId,
  };
}
const checkIn = (classId: string, userId: string) =>
  event(classId, userId, 'CHECK_IN', { anonymousName: userId });
const call = (classId: string, userId: string, outcome: string) =>
  event(classId, userId, 'COLD_CALL', { outcome });

const roster = [
  { userId: 'a', name: 'Ada', email: 'ada@example.edu' },
  { userId: 'b', name: 'Ben', email: 'ben@example.edu' },
  { userId: 'c', name: '=Cal', email: 'cal@example.edu' },
];
const sessions = [
  { classId: 'm1', name: 'Week 1', startedAt: new Date('2026-09-01T14:00:00Z') },
  { classId: 'm2', name: 'Week 2', startedAt: new Date('2026-09-08T14:00:00Z') },
];

function build() {
  const absentB = call('m1', 'b', 'absent');
  const absentC = call('m2', 'c', 'absent');
  const examId = 'exam-1';
  const fail = event('m2', 'a', 'EXAM_FAILED', { examId });
  const m1: Meeting = {
    courseId: 'course',
    classId: 'm1',
    events: [
      checkIn('m1', 'a'),
      checkIn('m1', 'b'),
      checkIn('m1', 'c'),
      call('m1', 'a', 'answered'),
      call('m1', 'a', 'skip'),
      absentB,
      event('m1', 'b', 'COLD_CALL_EXCUSED', { reason: 'Nurse visit' }, absentB.id),
      event('m1', 'c', 'HAND_RAISED'),
      event('m1', 'c', 'HAND_ACKNOWLEDGED', { handRaiseId: 'h' }),
    ],
  };
  const m2: Meeting = {
    courseId: 'course',
    classId: 'm2',
    events: [
      checkIn('m2', 'a'),
      checkIn('m2', 'c'),
      event('m2', null, 'EXAM_STARTED', { examId, domains: ['x.edu'], thresholdSeconds: 30 }),
      fail,
      event('m2', 'a', 'EXAM_EXCUSED', { examId, reason: 'AP outage' }, fail.id),
      call('m2', 'a', 'pass'),
      absentC,
    ],
  };
  return courseReport([m1, m2], sessions, roster, DEFAULT_CONFIG);
}

describe('course report', () => {
  it('totals attendance, participation, grade, and exam events per student', () => {
    const report = build();
    expect(report.sessionsHeld).toBe(2);
    // Answers a=1, b=0, c=0: projected (term = held) 1, 0, 0; median 0; A = A_min = 3.
    expect(report.A).toBe(3);
    const [ada, ben, cal] = report.students;
    expect(ada).toMatchObject({
      sessionsAttended: 2,
      answers: 1,
      passes: 1,
      opportunities: 2,
      score: 0.5,
      examFails: 1,
      examFailsExcused: 1,
    });
    // An excused absence is listed but is not an opportunity.
    expect(ben).toMatchObject({
      sessionsAttended: 1,
      absences: 0,
      excusedAbsences: 1,
      opportunities: 0,
      score: null,
    });
    expect(cal).toMatchObject({
      handRaises: 1,
      volunteerAnswers: 1,
      absences: 1,
      opportunities: 1,
      // (0 + min(1, cap 2)) / min(3, 1) = 1.
      score: 1,
    });
  });

  it('totals each session and lists absences with their excuse state', () => {
    const report = build();
    expect(report.sessions).toEqual([
      expect.objectContaining({
        classId: 'm1',
        checkedIn: 3,
        calls: 1,
        answers: 1,
        absences: 0,
        volunteerAnswers: 1,
        examFails: 0,
      }),
      expect.objectContaining({ classId: 'm2', checkedIn: 2, calls: 2, absences: 1, examFails: 1 }),
    ]);
    expect(report.absences).toEqual([
      expect.objectContaining({ userId: 'b', excused: true, reason: 'Nurse visit', classId: 'm1' }),
      expect.objectContaining({ userId: 'c', excused: false, reason: null, classId: 'm2' }),
    ]);
  });
});

it('counts exam fails from every exam in a meeting', () => {
  const first = event('m1', 'a', 'EXAM_FAILED', { examId: 'exam-1' });
  const second = event('m1', 'a', 'EXAM_FAILED', { examId: 'exam-2' });
  const meeting: Meeting = {
    courseId: 'course',
    classId: 'm1',
    events: [
      checkIn('m1', 'a'),
      event('m1', null, 'EXAM_STARTED', {
        examId: 'exam-1',
        domains: ['x.edu'],
        thresholdSeconds: 30,
      }),
      first,
      event('m1', null, 'EXAM_ENDED', { examId: 'exam-1' }),
      event('m1', null, 'EXAM_STARTED', {
        examId: 'exam-2',
        domains: ['x.edu'],
        thresholdSeconds: 30,
      }),
      second,
      event('m1', 'b', 'EXAM_FAILED', { examId: 'exam-2' }),
      event('m1', 'a', 'EXAM_EXCUSED', { examId: 'exam-1', reason: 'AP outage' }, first.id),
    ],
  };
  const report = courseReport([meeting], sessions.slice(0, 1), roster, DEFAULT_CONFIG);
  expect(report.students[0]).toMatchObject({ examFails: 2, examFailsExcused: 1 });
  expect(report.students[1]).toMatchObject({ examFails: 1, examFailsExcused: 0 });
  expect(report.sessions[0].examFails).toBe(3);
});

describe('CSV export', () => {
  const exportedAt = new Date('2026-10-06T12:00:00Z');
  const config = { ...DEFAULT_CONFIG, term_meetings: 26 };

  it('stamps every configuration value in force on every row', () => {
    const lines = studentsCsv(build(), config, exportedAt).trim().split('\r\n');
    const header = lines[0].split(',');
    for (const key of Object.keys(config)) {
      expect(header).toContain(`config_${key}`);
    }
    expect(lines).toHaveLength(4);
    for (const line of lines.slice(1)) {
      const row = Object.fromEntries(header.map((name, index) => [name, line.split(',')[index]]));
      expect(row).toMatchObject({
        config_term_meetings: '26',
        config_ratio: '0.7',
        config_called_today_damping: '0.2',
        exported_at: '2026-10-06T12:00:00.000Z',
      });
    }
    const sessionLines = sessionsCsv(build(), config, exportedAt).trim().split('\r\n');
    const sessionHeader = sessionLines[0].split(',');
    expect(sessionLines).toHaveLength(3);
    for (const line of sessionLines.slice(1)) {
      expect(line.split(',')[sessionHeader.indexOf('config_term_meetings')]).toBe('26');
    }
  });

  it('exports components, never the score alone', () => {
    const header = studentsCsv(build(), config, exportedAt).split('\r\n')[0].split(',');
    expect(header).toEqual(
      expect.arrayContaining([
        'answers',
        'passes',
        'absences',
        'opportunities',
        'A_in_force',
        'score',
      ])
    );
  });

  it('quotes separators and neutralizes formula-like text', () => {
    expect(toCsv([['=SUM(A1)', 'a,b', 'say "hi"', null, 3]])).toBe(
      `'=SUM(A1),"a,b","say ""hi""",,3\r\n`
    );
    expect(studentsCsv(build(), config, exportedAt)).toContain(",'=Cal,");
  });
});
