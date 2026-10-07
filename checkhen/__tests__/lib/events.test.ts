import { effectiveEvents, foldEvents, ParticipationEvent } from '@/lib/events';

const scope = { courseId: 'course-a', classId: 'session-a' };
const event = (
  id: string,
  kind: ParticipationEvent['kind'],
  payload = {},
  supersedesId: string | null = null
): ParticipationEvent => ({
  id,
  kind,
  payload,
  supersedesId,
  ...scope,
  userId: 'student',
  createdAt: new Date(1000),
});

it('folds two concurrent courses without crossing data', () => {
  const events = [
    event('01', 'CHECK_IN', { anonymousName: 'Swift Panda' }),
    {
      ...event('02', 'CHECK_IN', { anonymousName: 'Calm Otter' }),
      courseId: 'course-b',
      classId: 'session-b',
    },
    event('03', 'CHAT_MESSAGE', { message: 'A only', anonymousName: 'Swift Panda' }),
  ];
  expect(foldEvents(events, scope).attendance[0].anonymousName).toBe('Swift Panda');
  const b = foldEvents(events, { courseId: 'course-b', classId: 'session-b' });
  expect(b.attendance[0].anonymousName).toBe('Calm Otter');
  expect(b.messages).toEqual([]);
});

it('correction and undo append facts while preserving all original events', () => {
  const events = [event('01', 'PACE_SIGNAL', { signalType: 'slow_down' })];
  events.push(event('02', 'PACE_SIGNAL', { signalType: 'ready_to_move_on' }, '01'));
  expect(foldEvents(events, scope).pace[0].signalType).toBe('ready_to_move_on');
  events.push(event('03', 'UNDO', {}, '02'));
  expect(foldEvents(events, scope).pace[0].signalType).toBe('slow_down');
  events.push(event('04', 'UNDO', {}, '03'));
  expect(foldEvents(events, scope).pace[0].signalType).toBe('ready_to_move_on');
  expect(events.map((e) => e.id)).toEqual(['01', '02', '03', '04']);
  expect(events[0].payload).toEqual({ signalType: 'slow_down' });
});

it('orders equal timestamps by ID, independent of input order', () => {
  const events = [
    event('02', 'CHECK_OUT'),
    event('01', 'CHECK_IN', { anonymousName: 'Swift Panda' }),
  ];
  expect(foldEvents(events, scope).attendance[0].isPresent).toBe(false);
  expect(foldEvents(events.reverse(), scope).attendance[0].isPresent).toBe(false);
});

it('replaces a student’s earlier pace signal with the latest one', () => {
  const state = foldEvents(
    [
      event('01', 'PACE_SIGNAL', { signalType: 'slow_down' }),
      event('02', 'PACE_SIGNAL', { signalType: 'ready_to_move_on' }),
    ],
    scope
  );
  expect(state.pace).toHaveLength(1);
  expect(state.pace[0]).toMatchObject({ id: '02', signalType: 'ready_to_move_on' });
});

it('keeps one attendance record when a second device binds', () => {
  const first = event('01', 'CHECK_IN', {
    anonymousName: 'Swift Panda',
    deviceIp: '172.16.77.20',
    deviceMac: '02:00:00:00:00:20',
  });
  const second = event('02', 'DEVICE_BOUND', {
    deviceIp: '172.16.77.21',
    deviceMac: '02:00:00:00:00:21',
  });
  expect(foldEvents([first, second], scope).attendance[0].devices).toHaveLength(2);
  expect(foldEvents([first, second], scope).attendance[0].deviceIp).toBe('172.16.77.20');
});

it('rejects forward, missing, and cross-course supersession targets', () => {
  expect(() =>
    effectiveEvents([event('01', 'UNDO', {}, '02'), event('02', 'CHECK_OUT')], scope)
  ).toThrow();
  expect(() => effectiveEvents([event('01', 'UNDO', {}, 'missing')], scope)).toThrow();
  expect(() =>
    effectiveEvents(
      [{ ...event('01', 'CHECK_OUT'), courseId: 'course-b' }, event('02', 'UNDO', {}, '01')],
      scope
    )
  ).toThrow();
});

it('derives hand state, pace reset, and session checkout without changing stored facts', () => {
  const events = [
    event('01', 'CHECK_IN', { anonymousName: 'Swift Panda' }),
    event('02', 'HAND_RAISED'),
    event('03', 'HAND_ACKNOWLEDGED', { handRaiseId: '02' }),
    event('04', 'HAND_RATED', { handRaiseId: '02', hasValue: true }),
    event('05', 'PACE_SIGNAL', { signalType: 'slow_down' }),
    event('06', 'PACE_RESET'),
    event('07', 'SESSION_ENDED'),
  ];
  const original = JSON.stringify(events);
  const state = foldEvents(events, scope);
  expect(state.hands[0]).toMatchObject({ isAcknowledged: true, isRated: true, hasValue: true });
  expect(state.pace).toEqual([]);
  expect(state.attendance[0].isPresent).toBe(false);
  expect(JSON.stringify(events)).toBe(original);
});

it('keeps a corrected hand raise addressable by its original ID', () => {
  const events = [
    event('01', 'HAND_RAISED'),
    event('02', 'HAND_RAISED', {}, '01'),
    event('03', 'HAND_ACKNOWLEDGED', { handRaiseId: '01' }),
  ];
  expect(foldEvents(events, scope).hands[0]).toMatchObject({ id: '01', isAcknowledged: true });
});

it('folds exam fail and excuse while retaining the failed fact', () => {
  const events = [
    event('01', 'EXAM_STARTED', {
      examId: 'exam-1',
      domains: ['exam.example'],
      thresholdSeconds: 30,
    }),
    event('02', 'EXAM_FAILED', { examId: 'exam-1' }),
  ];
  expect(foldEvents(events, scope).examFails[0]).toMatchObject({ id: '02', excused: false });
  events.push(
    event('03', 'EXAM_EXCUSED', { examId: 'exam-1', reason: 'Verified cable fault' }, '02')
  );
  expect(foldEvents(events, scope).examFails[0]).toMatchObject({
    id: '02',
    excused: true,
    reason: 'Verified cable fault',
  });
  expect(events[1].kind).toBe('EXAM_FAILED');
  events.push(event('04', 'EXAM_ENDED', { examId: 'exam-1' }));
  expect(foldEvents(events, scope).exam?.active).toBe(false);
});

it('hides chat by an immutable moderation event and mutes only this session', () => {
  const events = [
    event('01', 'CHECK_IN', { anonymousName: 'Swift Panda' }),
    event('02', 'CHAT_MESSAGE', { message: 'Question?', anonymousName: 'Swift Panda' }),
    event('03', 'CHAT_HIDDEN', { messageId: '02' }, '02'),
    event('04', 'STUDENT_MUTED'),
  ];
  expect(foldEvents(events, scope).messages).toEqual([]);
  expect(foldEvents(events, scope).instructorMessages[0]).toMatchObject({
    id: '02',
    message: 'Question?',
    hidden: true,
    hideEventId: '03',
  });
  expect(foldEvents(events, scope).mutedUsers).toEqual(['student']);
  expect(foldEvents(events, { courseId: 'other', classId: 'other' }).mutedUsers).toEqual([]);
  expect(events[1].payload).toEqual({ message: 'Question?', anonymousName: 'Swift Panda' });
  events.push(event('05', 'UNDO', {}, '03'));
  expect(foldEvents(events, scope).messages[0].message).toBe('Question?');
  expect(foldEvents(events, scope).instructorMessages[0].hidden).toBe(false);
});

it('addresses the effective message after a chat correction', () => {
  const events = [
    event('01', 'CHAT_MESSAGE', { message: 'Old text', anonymousName: 'Swift Panda' }),
    event('02', 'CHAT_MESSAGE', { message: 'Corrected text', anonymousName: 'Swift Panda' }, '01'),
  ];
  expect(foldEvents(events, scope).messages[0].id).toBe('02');
  events.push(event('03', 'CHAT_HIDDEN', { messageId: '02' }, '02'));
  expect(foldEvents(events, scope).messages).toEqual([]);
});

it('keeps only the newest correction in a chain', () => {
  const events = [
    event('01', 'CHAT_MESSAGE', { message: 'First', anonymousName: 'Swift Panda' }),
    event('02', 'CHAT_MESSAGE', { message: 'Second', anonymousName: 'Swift Panda' }, '01'),
    event('03', 'CHAT_MESSAGE', { message: 'Third', anonymousName: 'Swift Panda' }, '02'),
  ];
  expect(foldEvents(events, scope).messages.map((message) => message.message)).toEqual(['Third']);
});

it('keeps every fail, across exams and after an exam ends (M5 findings 3 and 11)', () => {
  const start = (id: string, examId: string) =>
    event(id, 'EXAM_STARTED', { examId, domains: ['exam.example'], thresholdSeconds: 30 });
  const events = [
    start('01', 'exam-1'),
    event('02', 'EXAM_FAILED', { examId: 'exam-1', failId: 'drop-1' }),
    event('03', 'EXAM_EXCUSED', { examId: 'exam-1', reason: 'AP outage' }, '02'),
    // A later drop in the same exam, after the excuse, is a second fail.
    event('04', 'EXAM_FAILED', { examId: 'exam-1', failId: 'drop-2' }),
    event('05', 'EXAM_ENDED', { examId: 'exam-1' }),
    start('06', 'exam-2'),
    event('07', 'EXAM_FAILED', { examId: 'exam-2', failId: 'drop-3' }),
  ];
  const state = foldEvents(events, scope);
  expect(state.exam).toMatchObject({ id: 'exam-2', active: true });
  expect(state.examFails).toEqual([
    expect.objectContaining({ id: '02', examId: 'exam-1', excused: true, reason: 'AP outage' }),
    expect.objectContaining({ id: '04', examId: 'exam-1', excused: false }),
    expect.objectContaining({ id: '07', examId: 'exam-2', excused: false }),
  ]);
});
