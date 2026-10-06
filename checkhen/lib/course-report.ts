/** I4 course record: attendance, participation, grade, and exam events from the event log. */
import { grades, type ColdCallConfig, type Meeting } from './cold-call';
import { effectiveEvents } from './events';

export type SessionMeta = { classId: string; name: string; startedAt: Date };
export type RosterStudent = { userId: string; name: string; email: string };

export type StudentRow = {
  userId: string;
  name: string;
  email: string;
  sessionsAttended: number;
  sessionsHeld: number;
  handRaises: number;
  volunteerAnswers: number;
  answers: number;
  passes: number;
  absences: number;
  excusedAbsences: number;
  opportunities: number;
  projectedAnswers: number;
  A: number;
  volunteerCap: number;
  score: number | null;
  examFails: number;
  examFailsExcused: number;
};

export type SessionRow = {
  classId: string;
  name: string;
  startedAt: Date;
  checkedIn: number;
  calls: number;
  answers: number;
  absences: number;
  volunteerAnswers: number;
  examFails: number;
};

export type AbsenceRow = {
  callId: string;
  classId: string;
  sessionName: string;
  startedAt: Date;
  userId: string;
  name: string;
  excused: boolean;
  reason: string | null;
};

export type CourseReport = {
  sessionsHeld: number;
  A: number;
  students: StudentRow[];
  sessions: SessionRow[];
  absences: AbsenceRow[];
};

/** `meetings` and `sessions` hold the same held sessions in meeting order. */
export function courseReport(
  meetings: Meeting[],
  sessions: SessionMeta[],
  roster: RosterStudent[],
  config: ColdCallConfig
): CourseReport {
  const graded = new Map(
    grades(
      meetings,
      roster.map((student) => student.userId),
      config
    ).map((grade) => [grade.userId, grade])
  );
  const nameOf = (userId: string) =>
    roster.find((student) => student.userId === userId)?.name ?? userId;
  const attended = new Map<string, number>();
  const handRaises = new Map<string, number>();
  const examFails = new Map<string, { fails: number; excused: number }>();
  const sessionRows: SessionRow[] = [];
  const absences: AbsenceRow[] = [];

  meetings.forEach((meeting, index) => {
    const session = sessions[index];
    const effective = effectiveEvents(meeting.events, meeting);
    const checkedIn = new Set(
      effective.filter((event) => event.kind === 'CHECK_IN').map((event) => event.userId!)
    );
    for (const userId of Array.from(checkedIn)) {
      attended.set(userId, (attended.get(userId) ?? 0) + 1);
    }
    let calls = 0;
    let answers = 0;
    let absent = 0;
    let volunteers = 0;
    for (const event of effective) {
      if (!event.userId) {
        continue;
      }
      if (event.kind === 'HAND_RAISED') {
        handRaises.set(event.userId, (handRaises.get(event.userId) ?? 0) + 1);
      }
      if (event.kind === 'HAND_ACKNOWLEDGED') {
        volunteers += 1;
      }
      if (event.kind === 'COLD_CALL' && event.payload.outcome !== 'skip') {
        calls += 1;
        answers += event.payload.outcome === 'answered' ? 1 : 0;
      }
      const row = {
        classId: meeting.classId,
        sessionName: session.name,
        startedAt: session.startedAt,
        userId: event.userId,
        name: nameOf(event.userId),
      };
      if (event.kind === 'COLD_CALL' && event.payload.outcome === 'absent') {
        absent += 1;
        absences.push({ ...row, callId: event.id, excused: false, reason: null });
      }
      if (event.kind === 'COLD_CALL_EXCUSED') {
        absences.push({
          ...row,
          callId: event.supersedesId!,
          excused: true,
          reason: String(event.payload.reason),
        });
      }
    }
    // Count fails across every exam in the meeting. An excuse supersedes its fail,
    // so each fail appears once: as EXAM_FAILED, or as EXAM_EXCUSED once excused.
    let fails = 0;
    for (const event of effective) {
      if (event.userId && (event.kind === 'EXAM_FAILED' || event.kind === 'EXAM_EXCUSED')) {
        const entry = examFails.get(event.userId) ?? { fails: 0, excused: 0 };
        entry.fails += 1;
        entry.excused += event.kind === 'EXAM_EXCUSED' ? 1 : 0;
        examFails.set(event.userId, entry);
        fails += 1;
      }
    }
    sessionRows.push({
      classId: meeting.classId,
      name: session.name,
      startedAt: session.startedAt,
      checkedIn: checkedIn.size,
      calls,
      answers,
      absences: absent,
      volunteerAnswers: volunteers,
      examFails: fails,
    });
  });

  const students = roster.map((student) => {
    const grade = graded.get(student.userId)!;
    return {
      userId: student.userId,
      name: student.name,
      email: student.email,
      sessionsAttended: attended.get(student.userId) ?? 0,
      sessionsHeld: meetings.length,
      handRaises: handRaises.get(student.userId) ?? 0,
      volunteerAnswers: grade.volunteerAnswers,
      answers: grade.answers,
      passes: grade.passes,
      absences: grade.absences,
      excusedAbsences: grade.excusedAbsences,
      opportunities: grade.opportunities,
      projectedAnswers: grade.projectedAnswers,
      A: grade.A,
      volunteerCap: grade.volunteerCap,
      score: grade.score,
      examFails: examFails.get(student.userId)?.fails ?? 0,
      examFailsExcused: examFails.get(student.userId)?.excused ?? 0,
    };
  });
  return {
    sessionsHeld: meetings.length,
    A: students[0]?.A ?? config.A_min,
    students,
    sessions: sessionRows,
    absences,
  };
}

type Cell = string | number | null | boolean;

/** CSV with formula-looking text neutralized, so a name cannot run in a spreadsheet. */
export function toCsv(rows: Cell[][]): string {
  const cell = (value: Cell) => {
    if (value === null) {
      return '';
    }
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Every row carries the configuration in force and the export time. */
function stamp(config: ColdCallConfig, exportedAt: Date) {
  const keys = Object.keys(config).sort() as (keyof ColdCallConfig)[];
  return {
    header: [...keys.map((key) => `config_${key}`), 'exported_at'],
    values: [...keys.map((key) => config[key]), exportedAt.toISOString()],
  };
}

export function studentsCsv(report: CourseReport, config: ColdCallConfig, exportedAt: Date) {
  const { header, values } = stamp(config, exportedAt);
  return toCsv([
    [
      'student_id',
      'name',
      'email',
      'sessions_attended',
      'sessions_held',
      'hand_raises',
      'answers',
      'passes',
      'absences',
      'excused_absences',
      'opportunities',
      'volunteer_answers',
      'volunteer_cap',
      'projected_answers',
      'A_in_force',
      'score',
      'exam_fails',
      'exam_fails_excused',
      ...header,
    ],
    ...report.students.map((row) => [
      row.userId,
      row.name,
      row.email,
      row.sessionsAttended,
      row.sessionsHeld,
      row.handRaises,
      row.answers,
      row.passes,
      row.absences,
      row.excusedAbsences,
      row.opportunities,
      row.volunteerAnswers,
      row.volunteerCap,
      Math.round(row.projectedAnswers * 100) / 100,
      row.A,
      row.score === null ? null : Math.round(row.score * 10000) / 10000,
      row.examFails,
      row.examFailsExcused,
      ...values,
    ]),
  ]);
}

export function sessionsCsv(report: CourseReport, config: ColdCallConfig, exportedAt: Date) {
  const { header, values } = stamp(config, exportedAt);
  return toCsv([
    [
      'session_id',
      'session',
      'started_at',
      'checked_in',
      'cold_calls',
      'answers',
      'absences',
      'volunteer_answers',
      'exam_fails',
      ...header,
    ],
    ...report.sessions.map((row) => [
      row.classId,
      row.name,
      row.startedAt.toISOString(),
      row.checkedIn,
      row.calls,
      row.answers,
      row.absences,
      row.volunteerAnswers,
      row.examFails,
      ...values,
    ]),
  ]);
}
