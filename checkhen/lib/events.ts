/** Immutable participation facts. Derived state is computed when read. */
export type EventKind =
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'HAND_RAISED'
  | 'HAND_LOWERED'
  | 'HAND_ACKNOWLEDGED'
  | 'HAND_RATED'
  | 'PACE_SIGNAL'
  | 'PACE_RESET'
  | 'CHAT_MESSAGE'
  | 'CHAT_HIDDEN'
  | 'STUDENT_MUTED'
  | 'EXAM_STARTED'
  | 'EXAM_ENDED'
  | 'EXAM_FAILED'
  | 'EXAM_EXCUSED'
  | 'SESSION_ENDED'
  | 'DEVICE_BOUND'
  | 'DEVICE_UNBOUND'
  | 'COLD_CALL'
  | 'COLD_CALL_DRAWN'
  | 'COLD_CALL_EXCUSED'
  | 'UNDO';

export type ParticipationEvent = {
  id: string;
  courseId: string;
  classId: string;
  userId: string | null;
  kind: EventKind;
  payload: Record<string, unknown>;
  createdAt: Date;
  supersedesId: string | null;
};

export type EventScope = { courseId: string; classId: string };

export function compareEvents(a: ParticipationEvent, b: ParticipationEvent): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A superseder has an effect only if it is itself effective. Undo is undoable. */
export function effectiveEvents(
  events: ParticipationEvent[],
  scope: EventScope
): ParticipationEvent[] {
  const ordered = events
    .filter((e) => e.courseId === scope.courseId && e.classId === scope.classId)
    .slice()
    .sort(compareEvents);
  const byId = new Map(ordered.map((e) => [e.id, e]));
  if (byId.size !== ordered.length) throw new Error('Duplicate event ID');
  for (const event of ordered) {
    if (!event.supersedesId) continue;
    const target = byId.get(event.supersedesId);
    if (!target || compareEvents(target, event) >= 0) throw new Error('Invalid supersession');
  }
  const superseded = new Set<string>();
  const effective: ParticipationEvent[] = [];
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const event = ordered[i];
    if (superseded.has(event.id)) continue;
    if (event.supersedesId) superseded.add(event.supersedesId);
    if (event.kind !== 'UNDO') effective.push(event);
  }
  return effective.reverse();
}

export function foldEvents(events: ParticipationEvent[], scope: EventScope) {
  const attendance = new Map<
    string,
    {
      id: string;
      userId: string;
      classId: string;
      anonymousName: string;
      deviceIp: string | null;
      devices: { ip: string; mac: string }[];
      createdAt: Date;
      checkOutTime: Date | null;
      isPresent: boolean;
    }
  >();
  const hands = new Map<
    string,
    {
      id: string;
      userId: string;
      classId: string;
      createdAt: Date;
      isAcknowledged: boolean;
      isRated: boolean;
      hasValue: boolean;
    }
  >();
  const pace = new Map<
    string,
    { id: string; userId: string; classId: string; signalType: string; createdAt: Date }
  >();
  const messages = new Map<
    string,
    {
      id: string;
      userId: string;
      classId: string;
      message: string;
      anonymousName: string;
      createdAt: Date;
    }
  >();
  const hiddenMessages = new Map<
    string,
    {
      id: string;
      userId: string;
      classId: string;
      message: string;
      anonymousName: string;
      createdAt: Date;
      hidden: true;
      hideEventId: string;
    }
  >();
  const mutedUsers = new Set<string>();
  // Keyed by fail event: every drop stays listed, across exams and after an exam ends.
  const examFails = new Map<
    string,
    {
      id: string;
      userId: string;
      examId: string;
      createdAt: Date;
      excused: boolean;
      reason: string | null;
    }
  >();
  let exam: {
    id: string;
    domains: string[];
    thresholdSeconds: number;
    startedAt: Date;
    active: boolean;
  } | null = null;
  let endedAt: Date | null = null;
  const byId = new Map(
    events
      .filter((e) => e.courseId === scope.courseId && e.classId === scope.classId)
      .map((e) => [e.id, e])
  );
  const originalId = (event: ParticipationEvent): string => {
    let root = event;
    while (root.supersedesId) root = byId.get(root.supersedesId)!;
    return root.id;
  };
  for (const event of effectiveEvents(events, scope)) {
    const { userId, classId, createdAt, payload } = event;
    const id = originalId(event);
    if (event.kind === 'CHECK_IN' && userId) {
      const previous = attendance.get(userId);
      const deviceIp = typeof payload.deviceIp === 'string' ? payload.deviceIp : null;
      const devices =
        deviceIp && typeof payload.deviceMac === 'string'
          ? [{ ip: deviceIp, mac: payload.deviceMac }]
          : [];
      attendance.set(userId, {
        id,
        userId,
        classId,
        anonymousName: previous?.isPresent ? previous.anonymousName : String(payload.anonymousName),
        deviceIp,
        devices,
        createdAt: previous?.createdAt ?? createdAt,
        checkOutTime: null,
        isPresent: true,
      });
    } else if (event.kind === 'DEVICE_BOUND' && userId) {
      const entry = attendance.get(userId);
      if (
        entry?.isPresent &&
        typeof payload.deviceIp === 'string' &&
        typeof payload.deviceMac === 'string'
      ) {
        const devices = entry.devices.filter((device) => device.ip !== payload.deviceIp);
        devices.push({ ip: payload.deviceIp, mac: payload.deviceMac });
        attendance.set(userId, { ...entry, devices });
      }
    } else if (event.kind === 'DEVICE_UNBOUND' && userId) {
      const entry = attendance.get(userId);
      if (entry) {
        const mac = entry.devices.find((device) => device.ip === payload.deviceIp)?.mac;
        attendance.set(userId, {
          ...entry,
          devices: entry.devices.filter((device) =>
            mac ? device.mac !== mac : device.ip !== payload.deviceIp
          ),
        });
      }
    } else if (event.kind === 'CHECK_OUT' && userId) {
      const entry = attendance.get(userId);
      if (entry) attendance.set(userId, { ...entry, isPresent: false, checkOutTime: createdAt });
    } else if (event.kind === 'HAND_RAISED' && userId) {
      hands.set(id, {
        id,
        userId,
        classId,
        createdAt,
        isAcknowledged: false,
        isRated: false,
        hasValue: false,
      });
    } else if (event.kind === 'HAND_LOWERED') {
      hands.delete(String(payload.handRaiseId));
    } else if (event.kind === 'HAND_ACKNOWLEDGED' || event.kind === 'HAND_RATED') {
      const hand = hands.get(String(payload.handRaiseId));
      if (hand)
        hands.set(hand.id, {
          ...hand,
          ...(event.kind === 'HAND_ACKNOWLEDGED'
            ? { isAcknowledged: true }
            : { isRated: true, hasValue: payload.hasValue === true }),
        });
    } else if (event.kind === 'PACE_SIGNAL' && userId) {
      pace.set(userId, { id, userId, classId, signalType: String(payload.signalType), createdAt });
    } else if (event.kind === 'PACE_RESET') {
      pace.clear();
    } else if (event.kind === 'CHAT_MESSAGE' && userId) {
      messages.set(id, {
        id: event.id,
        userId,
        classId,
        createdAt,
        message: String(payload.message),
        anonymousName: String(payload.anonymousName),
      });
    } else if (event.kind === 'CHAT_HIDDEN') {
      const target = byId.get(event.supersedesId!)!;
      hiddenMessages.set(id, {
        id: target.id,
        userId: target.userId!,
        classId: target.classId,
        message: String(target.payload.message),
        anonymousName: String(target.payload.anonymousName),
        createdAt: target.createdAt,
        hidden: true,
        hideEventId: event.id,
      });
      messages.delete(id);
    } else if (event.kind === 'STUDENT_MUTED' && userId) {
      mutedUsers.add(userId);
    } else if (event.kind === 'EXAM_STARTED') {
      exam = {
        id: String(payload.examId),
        domains: Array.isArray(payload.domains) ? payload.domains.map(String) : [],
        thresholdSeconds: Number(payload.thresholdSeconds),
        startedAt: createdAt,
        active: true,
      };
    } else if (event.kind === 'EXAM_ENDED') {
      if (exam && exam.id === payload.examId) exam.active = false;
    } else if (event.kind === 'EXAM_FAILED' && userId) {
      examFails.set(event.id, {
        id: event.id,
        userId,
        examId: String(payload.examId),
        createdAt,
        excused: false,
        reason: null,
      });
    } else if (event.kind === 'EXAM_EXCUSED' && userId) {
      const failed = byId.get(event.supersedesId!);
      if (failed?.kind === 'EXAM_FAILED' && failed.payload.examId === payload.examId)
        examFails.set(failed.id, {
          id: failed.id,
          userId,
          examId: String(payload.examId),
          createdAt: failed.createdAt,
          excused: true,
          reason: String(payload.reason),
        });
    } else if (event.kind === 'SESSION_ENDED') {
      endedAt = createdAt;
      for (const [student, entry] of Array.from(attendance.entries())) {
        if (entry.isPresent)
          attendance.set(student, { ...entry, isPresent: false, checkOutTime: createdAt });
      }
    }
  }
  const instructorMessages = [
    ...Array.from(messages.values(), (message) => ({
      ...message,
      hidden: false,
      hideEventId: null as string | null,
    })),
    ...Array.from(hiddenMessages.values()),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    attendance: Array.from(attendance.values()),
    hands: Array.from(hands.values()),
    pace: Array.from(pace.values()),
    messages: Array.from(messages.values()),
    instructorMessages,
    mutedUsers: Array.from(mutedUsers),
    exam,
    examFails: Array.from(examFails.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    ),
    endedAt,
  };
}
