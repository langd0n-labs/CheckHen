import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './prisma';
import { isInstructor, requireScope } from './request-scope';
import { appendEvent, readState } from './event-store';
import { generateUniqueAnonymousName } from './anonymousNames';
import type { EventKind } from './events';
import { bindDevice, PortalBindingError, revokeCurrentDevice, revokeDevice, revokeSessionDevices, revokeStudentDevices } from './portal-binding';
import type { DeviceBinding } from './portal-binding';
import { instructorChat, studentChat } from './chat-view';

const writes = new Set(['check-in', 're-bind', 'check-out', 'toggle-vhr', 'send-chat', 'send-pace-signal',
  'ack-hand-raise', 'rate-hand-raise', 'reset-pace-signals', 'end-class-early', 'hide-chat', 'unhide-chat', 'mute-student']);

export function participationHandler(action: string, adminOnly = false) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== (writes.has(action) ? 'POST' : 'GET')) {
      return res.status(405).json({ message: 'Method Not Allowed' });
    }
    const context = await requireScope(req, res, adminOnly);
    if (!context) return;
    const { scope, user, selected } = context;
    const state = await readState(prisma, scope);
    const active = !state.endedAt && selected.createdAt.getTime() + selected.duration * 60000 > Date.now();
    const checkIn = state.attendance.find(entry => entry.userId === user.id);
    const ownHand = state.hands.find(entry => entry.userId === user.id && !entry.isAcknowledged);
    const pace = state.pace.filter(entry => entry.createdAt.getTime() >= Date.now() - 300000);
    const counts = {
      slowDown: pace.filter(entry => entry.signalType === 'slow_down').length,
      readyToMove: pace.filter(entry => entry.signalType === 'ready_to_move_on').length,
    };
    const append = (kind: EventKind, payload: Record<string, unknown> = {}, userId: string | null = user.id) =>
      appendEvent(prisma, { ...scope, actorId: user.id, userId, kind, payload });
    const json = (value: unknown) => res.status(200).json({ message: JSON.stringify(value) });
    if (writes.has(action) && !active && action !== 'check-out') return res.status(400).json({ message: 'No active class' });
    if (!adminOnly && writes.has(action) && !['check-in', 'check-out', 're-bind'].includes(action) && !checkIn?.isPresent) {
      return res.status(400).json({ message: 'Not currently checked in to this class' });
    }
    if (action === 'check-in' || action === 're-bind') {
      if (action === 're-bind' && !checkIn?.isPresent) {
        return res.status(409).json({ message: 'No current check-in; no uplink' });
      }
      let binding: DeviceBinding | null = null;
      try {
        binding = await bindDevice(req, scope, user);
        if (!checkIn?.isPresent) {
          const anonymousName = checkIn?.anonymousName ??
            generateUniqueAnonymousName(state.attendance.map(entry => entry.anonymousName));
          await append('CHECK_IN', { anonymousName, ...(binding ? { deviceIp: binding.ip, deviceMac: binding.mac } : {}) });
        } else if (binding) {
          const bound = binding;
          if (!checkIn.devices?.some(device => device.ip === bound.ip && device.mac === bound.mac)) {
            await append('DEVICE_BOUND', { deviceIp: bound.ip, deviceMac: bound.mac });
          }
        }
      } catch (error) {
        const bound = binding;
        if (bound && !checkIn?.devices?.some(device => device.ip === bound.ip && device.mac === bound.mac)) {
          try { await revokeDevice(binding, scope, user); } catch { /* Preserve the append failure. */ }
        }
        if (error instanceof PortalBindingError) return res.status(error.status).json({ message: error.message });
        throw error;
      }
      return res.json({ message: 'Checked in' });
    }
    if (action === 'check-out') {
      const currentIp = req.headers['x-real-ip'];
      const primaryMac = checkIn?.devices?.find(device => device.ip === checkIn.deviceIp)?.mac;
      const currentMac = checkIn?.devices?.find(device => device.ip === currentIp)?.mac;
      const secondary = !!(checkIn?.devices?.length && currentMac && primaryMac && currentMac !== primaryMac);
      try {
        if (secondary) await revokeCurrentDevice(req, scope, user);
        else await revokeStudentDevices(scope, user);
      } catch (error) {
        if (error instanceof PortalBindingError) return res.status(error.status).json({ message: error.message });
        throw error;
      }
      if (secondary && typeof currentIp === 'string') await append('DEVICE_UNBOUND', { deviceIp: currentIp });
      if (!secondary && checkIn?.isPresent) await append('CHECK_OUT');
      return res.json({ message: 'Checked out' });
    }
    if (action === 'toggle-vhr') {
      await append(ownHand ? 'HAND_LOWERED' : 'HAND_RAISED', ownHand ? { handRaiseId: ownHand.id } : {});
      return res.json({ message: 'Hand updated', status: !ownHand, classId: scope.classId });
    }
    if (action === 'send-pace-signal') {
      const signalType = req.body?.signalType;
      if (!['slow_down', 'ready_to_move_on'].includes(signalType)) return res.status(400).json({ message: 'Invalid signal type' });
      await append('PACE_SIGNAL', { signalType });
      return res.json({ message: 'Pace signal recorded', signalType });
    }
    if (action === 'send-chat') {
      if (state.mutedUsers?.includes(user.id)) return res.status(403).json({ message: 'Muted for this class' });
      const message = req.body?.message;
      if (typeof message !== 'string' || !message.trim() || message.length > 1000) {
        return res.status(400).json({ message: 'Invalid message' });
      }
      const event = await append('CHAT_MESSAGE', { message, anonymousName: checkIn!.anonymousName });
      return json({ id: event.id, createdAt: event.createdAt, message, anonymousName: checkIn!.anonymousName });
    }
    if (action === 'hide-chat') {
      const target = state.messages.find(message => message.id === req.body?.messageId);
      if (!target) return res.status(404).json({ message: 'Message not found' });
      await appendEvent(prisma, { ...scope, actorId: user.id, userId: target.userId,
        kind: 'CHAT_HIDDEN', payload: { messageId: target.id }, supersedesId: target.id });
      return res.json({ message: 'Message hidden' });
    }
    if (action === 'unhide-chat') {
      const target = state.instructorMessages.find(message => message.id === req.body?.messageId && message.hidden);
      if (!target?.hideEventId) return res.status(404).json({ message: 'Hidden message not found' });
      await appendEvent(prisma, { ...scope, actorId: user.id, userId: target.userId,
        kind: 'UNDO', payload: {}, supersedesId: target.hideEventId });
      return res.json({ message: 'Message restored' });
    }
    if (action === 'mute-student') {
      const targetId = req.body?.userId;
      if (typeof targetId !== 'string' || !state.attendance.some(entry => entry.userId === targetId)) {
        return res.status(404).json({ message: 'Student not found in this class' });
      }
      if (!state.mutedUsers?.includes(targetId)) await append('STUDENT_MUTED', {}, targetId);
      return res.json({ message: 'Student muted' });
    }
    if (action === 'reset-pace-signals') {
      await append('PACE_RESET', {}, null);
      return res.json({ message: 'Pace signals reset' });
    }
    if (action === 'end-class-early') {
      try {
        await revokeSessionDevices(scope);
      } catch (error) {
        if (error instanceof PortalBindingError) return res.status(error.status).json({ message: error.message });
        throw error;
      }
      const event = await append('SESSION_ENDED', {}, null);
      return json({ ...selected, endedAt: event.createdAt });
    }
    if (action === 'ack-hand-raise' || action === 'rate-hand-raise') {
      const target = await prisma.user.findUnique({ where: { email: String(req.body?.email || '') } });
      const hand = state.hands.find(entry => entry.userId === target?.id &&
        (action === 'ack-hand-raise' ? !entry.isAcknowledged : entry.isAcknowledged && !entry.isRated));
      if (!hand) return res.status(404).json({ message: 'No hand raise request found' });
      if (action === 'rate-hand-raise' && typeof req.body?.good !== 'boolean') return res.status(400).json({ message: 'Invalid rating' });
      await append(action === 'ack-hand-raise' ? 'HAND_ACKNOWLEDGED' : 'HAND_RATED',
        { handRaiseId: hand.id, ...(action === 'rate-hand-raise' ? { hasValue: req.body.good } : {}) }, hand.userId);
      return res.json({ message: 'Hand raise updated' });
    }
    if (action === 'fetch-check-in') {
      return active && checkIn?.isPresent ? json(checkIn) : res.status(404).json({ message: 'No check-in found' });
    }
    if (action === 'fetch-hand-raise' && !adminOnly) {
      return ownHand ? json(ownHand) : res.status(404).json({ message: 'No hand raise found' });
    }
    if (action === 'get-anonymous-name') {
      return checkIn ? res.json({ anonymousName: checkIn.anonymousName }) : res.status(404).json({ message: 'Not checked in' });
    }
    if (action === 'fetch-pace-signals') return res.json({ message: 'Pace signals fetched', ...counts });
    if (action === 'startup') {
      return res.json({
        isCheckedIn: active && !!checkIn?.isPresent,
        classId: selected.id, className: selected.name, classColor: selected.color,
        anonymousName: checkIn?.anonymousName ?? null, handRaised: !!ownHand,
        paceSignals: counts, messages: checkIn ? studentChat(state.messages.slice(-100), user.id) : [],
      });
    }
    if (!adminOnly && !checkIn) return res.status(403).json({ message: 'Not checked in' });
    if (action === 'fetch-all-chat' || action === 'fetch-last-chat') {
      const source = adminOnly ? (state.instructorMessages ?? state.messages) : state.messages;
      const messages = source.slice(action === 'fetch-last-chat' ? -1 : adminOnly ? -source.length : -25);
      if (!adminOnly) return json(studentChat(messages, user.id));
      const users = await prisma.user.findMany({ where: { id: { in: messages.map(m => m.userId) } } });
      return json(instructorChat(messages, users));
    }
    const users = await prisma.user.findMany({
      where: { id: { in: [...state.attendance, ...state.hands].map(entry => entry.userId) } },
    });
    if (action === 'fetch-check-ins') {
      return json(state.attendance.filter(entry => entry.isPresent).flatMap(entry => {
        const student = users.find(candidate => candidate.id === entry.userId);
        if (!student || isInstructor(student.email)) return [];
        return [{ ...entry, joinTime: entry.createdAt, email: student.email, name: student.email.split('@')[0],
          handRaiseCount: state.hands.filter(hand => hand.userId === student.id).length, user: student }];
      }));
    }
    if (action === 'fetch-hand-raise') {
      return json(state.hands.filter(entry => !entry.isRated).map(entry => {
        const student = users.find(candidate => candidate.id === entry.userId);
        return { id: entry.id, email: student?.email, name: student?.displayName || student?.email.split('@')[0],
          isAck: entry.isAcknowledged, isAcknowledged: entry.isAcknowledged,
          handRaiseCount: state.hands.filter(hand => hand.userId === entry.userId).length };
      }));
    }
    return res.status(404).json({ message: 'Unknown action' });
  };
}
