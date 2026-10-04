/** Immutable participation facts. Derived state is computed when read. */
export type EventKind =
  | 'CHECK_IN' | 'CHECK_OUT' | 'HAND_RAISED' | 'HAND_LOWERED'
  | 'HAND_ACKNOWLEDGED' | 'HAND_RATED' | 'PACE_SIGNAL' | 'PACE_RESET'
  | 'CHAT_MESSAGE' | 'SESSION_ENDED' | 'DEVICE_BOUND' | 'UNDO';

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
export function effectiveEvents(events: ParticipationEvent[], scope: EventScope): ParticipationEvent[] {
  const ordered = events.filter(e => e.courseId === scope.courseId && e.classId === scope.classId)
    .slice().sort(compareEvents);
  const byId = new Map(ordered.map(e => [e.id, e]));
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
  const attendance = new Map<string, { id: string; userId: string; classId: string; anonymousName: string; createdAt: Date; checkOutTime: Date | null; isPresent: boolean }>();
  const hands = new Map<string, { id: string; userId: string; classId: string; createdAt: Date; isAcknowledged: boolean; isRated: boolean; hasValue: boolean }>();
  const pace = new Map<string, { id: string; userId: string; classId: string; signalType: string; createdAt: Date }>();
  const messages: { id: string; userId: string; classId: string; message: string; anonymousName: string; createdAt: Date }[] = [];
  let endedAt: Date | null = null;
  const byId = new Map(events.filter(e => e.courseId === scope.courseId && e.classId === scope.classId).map(e => [e.id, e]));
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
      attendance.set(userId, { id, userId, classId, anonymousName: String(payload.anonymousName), createdAt: previous?.createdAt ?? createdAt, checkOutTime: null, isPresent: true });
    } else if (event.kind === 'CHECK_OUT' && userId) {
      const entry = attendance.get(userId);
      if (entry) attendance.set(userId, { ...entry, isPresent: false, checkOutTime: createdAt });
    } else if (event.kind === 'HAND_RAISED' && userId) {
      hands.set(id, { id, userId, classId, createdAt, isAcknowledged: false, isRated: false, hasValue: false });
    } else if (event.kind === 'HAND_LOWERED') {
      hands.delete(String(payload.handRaiseId));
    } else if (event.kind === 'HAND_ACKNOWLEDGED' || event.kind === 'HAND_RATED') {
      const hand = hands.get(String(payload.handRaiseId));
      if (hand) hands.set(hand.id, { ...hand, ...(event.kind === 'HAND_ACKNOWLEDGED' ? { isAcknowledged: true } : { isRated: true, hasValue: payload.hasValue === true }) });
    } else if (event.kind === 'PACE_SIGNAL' && userId) {
      pace.set(userId, { id, userId, classId, signalType: String(payload.signalType), createdAt });
    } else if (event.kind === 'PACE_RESET') {
      pace.clear();
    } else if (event.kind === 'CHAT_MESSAGE' && userId) {
      messages.push({ id, userId, classId, createdAt, message: String(payload.message), anonymousName: String(payload.anonymousName) });
    } else if (event.kind === 'SESSION_ENDED') {
      endedAt = createdAt;
      for (const [student, entry] of Array.from(attendance.entries())) {
        if (entry.isPresent) attendance.set(student, { ...entry, isPresent: false, checkOutTime: createdAt });
      }
    }
  }
  return { attendance: Array.from(attendance.values()), hands: Array.from(hands.values()), pace: Array.from(pace.values()), messages, endedAt };
}
