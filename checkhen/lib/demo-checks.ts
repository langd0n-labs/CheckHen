/**
 * Demo mode only: the simulated students answer an understanding check, so a visitor
 * sees the instructor's tally fill in. Answers are ordinary check events.
 */
import type { PrismaClient } from '@prisma/client';
import { answerCheck } from './checks';
import { databaseFull } from './demo-guard';
import { readState } from './event-store';
import type { EventScope } from './events';

/** Answers arrive over this span after the check opens. */
const FIRST_MS = 2_000;
const LAST_MS = 30_000;
const ANSWER_RATE = 0.85;
const ANOTHER_EXAMPLE_RATE = 0.3;

/**
 * One answer per checked-in student, at most: the number of writes is bounded by the
 * demo roster, and one check is open at a time.
 */
export async function simulateCheckAnswers(
  db: PrismaClient,
  scope: EventScope,
  checkId: string,
  random: () => number = Math.random
): Promise<void> {
  try {
    const state = await readState(db, scope);
    for (const entry of state.attendance.filter((candidate) => candidate.isPresent)) {
      if (random() >= ANSWER_RATE) {
        continue;
      }
      const choice = random() < ANOTHER_EXAMPLE_RATE ? 'another_example' : 'got_it';
      const delay = FIRST_MS + random() * (LAST_MS - FIRST_MS);
      setTimeout(async () => {
        try {
          if (await databaseFull()) {
            return;
          }
          await answerCheck(db, scope, entry.userId, checkId, choice);
        } catch {
          // The check closed or the student left: the answer is simply not given.
        }
      }, delay);
    }
  } catch {
    // A demo nicety; the check itself is already open.
  }
}
