/**
 * Demo mode only: simulated class chat, so a visitor can see the dashboard and the
 * lecture deck react as if students were typing. Messages are ordinary chat events
 * from checked-in demo students, so every view shows them the usual way.
 */
import type { PrismaClient } from '@prisma/client';
import { databaseFull } from './demo-guard';
import { appendEvent, readState } from './event-store';
import type { EventScope } from './events';

/** It stops on its own after this long, so a forgotten demo cannot grow without bound. */
export const CHATTER_MAX_MS = 10 * 60_000;
const MIN_GAP_MS = 2_000;
const MAX_GAP_MS = 6_000;

/** Things students say during the Farm Science lecture. */
export const CHATTER_LINES = [
  'Is milk yield continuous even if we round to the nearest litre?',
  'breed is categorical for sure',
  'eggs laid is a count, so discrete?',
  'wool grade has an order though, fine > medium > coarse',
  'ordinal! that is the word',
  'can a variable be both? like age in years vs age group',
  'what about temperature of the barn',
  'continuous, you can always measure more precisely',
  '+1 to the ordinal point',
  'wait so is discrete a kind of numerical?',
  'yes, numerical splits into discrete and continuous',
  'my farm counts cows in halves sometimes lol',
  'is weight of a fleece continuous?',
  'random sampling seems fairest',
  'stratified if the paddocks are really different',
  'convenience sampling = the friendly sheep only',
  'the sheep near the gate are probably the hungry ones',
  'so the gate sheep are biased toward being hungry',
  'how many sheep do we need to sample?',
  'does sample size depend on how varied the flock is?',
  'could we weigh every 10th sheep that walks through?',
  'that is systematic sampling right',
  'goats are not sheep though',
  'goats as a control feels like comparing apples and oranges',
  'unless the treatment works on both species',
  'a control group should be as similar as possible',
  'so the control should be other sheep',
  'what if there are not enough sheep',
  'could you use the same sheep before and after?',
  'paired design!',
  'is that a before/after study?',
  'can you go back a slide',
  'what was the second sampling type again',
  'this makes sense now',
  'will this be on the quiz?',
  'is the reading for this week chapter 5?',
  'hens are categorical by breed but numerical by eggs',
  'what about colour of the eggs',
  'colour is categorical',
  'unless you measure the wavelength haha',
  'that is a stretch',
  'can we get an example with pigs',
  'pig weight is continuous',
  'number of piglets per litter is discrete',
  'oh that is a good one',
  'do we use the same rules for crops?',
  'yield per acre continuous',
  'variety of wheat categorical',
  'thanks, that clears it up',
  'can you post the slides after class?',
];

type Running = { timer: ReturnType<typeof setTimeout>; endsAt: number; next: number };
const running = new Map<string, Running>();
const key = (scope: EventScope) => `${scope.courseId}:${scope.classId}`;

export function chatterStatus(scope: EventScope): { running: boolean; endsAt: number | null } {
  const entry = running.get(key(scope));
  return { running: !!entry, endsAt: entry?.endsAt ?? null };
}

export function stopChatter(scope: EventScope): void {
  const entry = running.get(key(scope));
  if (entry) clearTimeout(entry.timer);
  running.delete(key(scope));
}

/** Post one line from a random checked-in, unmuted student. False when it should stop. */
export async function postChatter(db: PrismaClient, scope: EventScope, line: string): Promise<boolean> {
  const state = await readState(db, scope);
  if (state.endedAt) return false;
  const speakers = state.attendance.filter(
    (entry) => entry.isPresent && !state.mutedUsers.includes(entry.userId)
  );
  if (!speakers.length) return false;
  const speaker = speakers[Math.floor(Math.random() * speakers.length)];
  await appendEvent(db, {
    ...scope,
    actorId: speaker.userId,
    userId: speaker.userId,
    kind: 'CHAT_MESSAGE',
    payload: { message: line, anonymousName: speaker.anonymousName },
  });
  return true;
}

/** Start, or keep running, simulated chat for this session. */
export function startChatter(db: PrismaClient, scope: EventScope, now = Date.now()) {
  const id = key(scope);
  const existing = running.get(id);
  if (existing) {
    existing.endsAt = now + CHATTER_MAX_MS;
    return chatterStatus(scope);
  }
  const entry: Running = {
    timer: setTimeout(() => undefined, 0),
    endsAt: now + CHATTER_MAX_MS,
    next: Math.floor(Math.random() * CHATTER_LINES.length),
  };
  const schedule = () => {
    const gap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
    entry.timer = setTimeout(tick, gap);
  };
  const tick = async () => {
    if (running.get(id) !== entry) return;
    try {
      if (Date.now() >= entry.endsAt || (await databaseFull())) {
        stopChatter(scope);
        return;
      }
      const line = CHATTER_LINES[entry.next % CHATTER_LINES.length];
      entry.next += 1;
      if (!(await postChatter(db, scope, line))) {
        stopChatter(scope);
        return;
      }
    } catch {
      stopChatter(scope);
      return;
    }
    if (running.get(id) === entry) schedule();
  };
  clearTimeout(entry.timer);
  running.set(id, entry);
  schedule();
  return chatterStatus(scope);
}
