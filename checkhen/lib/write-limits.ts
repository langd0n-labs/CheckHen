import { isDemo } from './demo';

/**
 * Per-student write limits on class deployments. A classroom shares one network
 * address, so the proxy's per-address limits cannot tell students apart; these count
 * each signed-in student separately. Each limit is far above what a student does by
 * hand. The demo shares its personas between visitors, so its own per-address gate
 * applies there instead.
 */
const PER_MINUTE: Record<string, number> = {
  'send-chat': 20,
  'toggle-vhr': 30,
  'send-pace-signal': 30,
  'check-in': 30,
  're-bind': 30,
  'check-out': 30,
};
const WINDOW_MS = 60_000;
// Counters for at most this many student-action pairs; the oldest is evicted first.
const MAX_KEYS = 10_000;

const windows = new Map<string, { start: number; count: number }>();

/** True when this student may make this write now. Records the attempt. */
export function allowStudentWrite(userId: string, action: string, now = Date.now()): boolean {
  const limit = PER_MINUTE[action];
  if (limit === undefined || isDemo()) return true;
  const key = `${action}:${userId}`;
  let counter = windows.get(key);
  if (!counter || now - counter.start >= WINDOW_MS) counter = { start: now, count: 0 };
  counter.count += 1;
  // Re-insert, so the map's order is oldest use first.
  windows.delete(key);
  while (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value!);
  windows.set(key, counter);
  return counter.count <= limit;
}

/** Tests only: forget every counter. */
export function resetWriteLimits() {
  windows.clear();
}
