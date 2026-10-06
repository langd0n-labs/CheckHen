import {
  DEFAULT_CONFIG,
  eligibility,
  grades,
  resolveConfig,
  seededRandom,
  select,
  weight,
  type CandidateFeatures,
  type Meeting,
} from '@/lib/cold-call';
import type { ParticipationEvent } from '@/lib/events';

const base: CandidateFeatures = {
  userId: 'a',
  passesOutstanding: 0,
  sessionsSinceCalled: 0,
  retryOutstanding: false,
  neverCalled: false,
  volunteered: false,
  calledToday: false,
};
const config = DEFAULT_CONFIG;

let clock = 0;
function event(
  classId: string,
  userId: string,
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
const call = (classId: string, userId: string, outcome: string) =>
  event(classId, userId, 'COLD_CALL', { outcome });
const meeting = (classId: string, events: ParticipationEvent[]): Meeting => ({
  courseId: 'course',
  classId,
  events,
});

describe('sampler weights', () => {
  it('is 1 for a student with no factors', () => {
    expect(weight(base, config)).toBe(1);
  });

  it('applies each factor by the formula', () => {
    expect(weight({ ...base, passesOutstanding: 1 }, config)).toBe(3);
    // Pass debt is capped at pass_cap = 2.
    expect(weight({ ...base, passesOutstanding: 5 }, config)).toBe(5);
    expect(weight({ ...base, sessionsSinceCalled: 4 }, config)).toBe(3);
    expect(weight({ ...base, retryOutstanding: true }, config)).toBe(3);
    expect(weight({ ...base, neverCalled: true }, config)).toBe(2);
    expect(weight({ ...base, volunteered: true }, config)).toBeCloseTo(0.6);
    expect(weight({ ...base, calledToday: true }, config)).toBeCloseTo(0.2);
  });

  it('multiplies factors together', () => {
    const all = {
      ...base,
      passesOutstanding: 1,
      sessionsSinceCalled: 2,
      retryOutstanding: true,
      neverCalled: true,
      volunteered: true,
    };
    expect(weight(all, config)).toBeCloseTo(3 * 2 * 3 * 2 * 0.6);
  });

  it('never falls below minimum_weight, including non-finite weights', () => {
    expect(weight({ ...base, volunteered: true }, { ...config, volunteer_damping: 0 })).toBe(0.01);
    expect(weight({ ...base, sessionsSinceCalled: Infinity }, config)).toBe(0.01);
    expect(weight({ ...base, retryOutstanding: true }, { ...config, retry_multiplier: NaN })).toBe(
      0.01
    );
  });
});

describe('selection', () => {
  const candidates = ['d', 'b', 'a', 'c'].map((userId, index) => ({
    ...base,
    userId,
    sessionsSinceCalled: index,
  }));

  it('replays identically from the same seed', () => {
    const draws = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 50 }, () => select(candidates, config, random));
    };
    expect(draws(12345)).toEqual(draws(12345));
    expect(draws(12345)).not.toEqual(draws(54321));
  });

  it('does not depend on input order', () => {
    const reversed = candidates.slice().reverse();
    for (let seed = 0; seed < 200; seed += 1) {
      expect(select(reversed, config, seededRandom(seed))).toBe(
        select(candidates, config, seededRandom(seed))
      );
    }
  });

  it('draws in proportion to weight', () => {
    const pair = [
      { ...base, userId: 'heavy', retryOutstanding: true },
      { ...base, userId: 'light' },
    ];
    const random = seededRandom(7);
    let heavy = 0;
    for (let draw = 0; draw < 20000; draw += 1) {
      if (select(pair, config, random) === 'heavy') {
        heavy += 1;
      }
    }
    expect(heavy / 20000).toBeCloseTo(0.75, 1);
  });

  it('walks the cumulative weights in ID order', () => {
    const pair = [
      { ...base, userId: 'b' },
      { ...base, userId: 'a', retryOutstanding: true },
    ];
    // Weights in ID order: a = 3, b = 1, total 4.
    expect(select(pair, config, () => 0.74)).toBe('a');
    expect(select(pair, config, () => 0.76)).toBe('b');
    expect(select([], config, () => 0.5)).toBeNull();
  });
});

describe('eligibility', () => {
  it('derives pass debt, recency, retry, and never-called from earlier meetings', () => {
    const meetings = [
      meeting('m1', [call('m1', 'a', 'pass'), call('m1', 'b', 'answered')]),
      meeting('m2', [call('m2', 'a', 'pass')]),
      meeting('m3', [call('m3', 'b', 'retry')]),
      meeting('m4', []),
    ];
    const result = eligibility(meetings, 3, ['a', 'b', 'c']);
    expect(result).toEqual([
      expect.objectContaining({
        userId: 'a',
        passesOutstanding: 2,
        sessionsSinceCalled: 1,
        neverCalled: false,
        eligible: true,
      }),
      expect.objectContaining({ userId: 'b', retryOutstanding: true, sessionsSinceCalled: 0 }),
      expect.objectContaining({ userId: 'c', neverCalled: true, sessionsSinceCalled: 3 }),
    ]);
  });

  it('counts intervening meetings the same way for called and never-called students', () => {
    // Called in meeting 1, sampled in meeting 3: one meeting in between.
    const meetings = [
      meeting('m1', [call('m1', 'a', 'answered')]),
      meeting('m2', []),
      meeting('m3', []),
    ];
    const result = eligibility(meetings, 2, ['a', 'b']);
    expect(result[0].sessionsSinceCalled).toBe(1);
    expect(weight(result[0], config)).toBe(1.5);
    // Never called counts as called before meeting 1: two meetings in between.
    expect(result[1].sessionsSinceCalled).toBe(2);
    // Called in the previous meeting: none in between.
    expect(eligibility(meetings.slice(0, 2), 1, ['a'])[0].sessionsSinceCalled).toBe(0);
  });

  it('keeps students called today callable at reduced weight and excludes absent students', () => {
    // Operator decision 2026-10-05: being called does not take a student off the hook.
    const today = [
      call('m1', 'a', 'answered'),
      call('m1', 'b', 'retry'),
      call('m1', 'c', 'absent'),
    ];
    const result = eligibility([meeting('m1', today)], 0, ['a', 'b', 'c', 'd']);
    expect(result.map((entry) => [entry.userId, entry.eligible, entry.calledToday])).toEqual([
      ['a', true, true],
      // An outstanding retry takes the retry weight, not the same-lecture damping.
      ['b', true, false],
      ['c', false, false],
      ['d', true, false],
    ]);
    expect(weight(result[0], config)).toBeCloseTo(0.2);
    expect(weight(result[1], config)).toBe(3);
  });

  it('makes an absent student callable again after they check in', () => {
    const events = [
      event('m1', 'a', 'CHECK_IN', { anonymousName: 'A' }),
      call('m1', 'a', 'absent'),
      event('m1', 'a', 'CHECK_OUT'),
    ];
    expect(eligibility([meeting('m1', events)], 0, ['a'])[0].eligible).toBe(false);
    events.push(event('m1', 'a', 'CHECK_IN', { anonymousName: 'A' }));
    expect(eligibility([meeting('m1', events)], 0, ['a'])[0].eligible).toBe(true);
  });

  it('treats a skip as if the call never happened', () => {
    const result = eligibility([meeting('m1', [call('m1', 'a', 'skip')])], 0, ['a']);
    expect(result[0]).toMatchObject({ eligible: true, calledToday: false, neverCalled: true });
    expect(grades([meeting('m1', [call('m1', 'a', 'skip')])], ['a'], config)[0]).toMatchObject({
      opportunities: 0,
      score: null,
    });
  });

  it('counts each answer in a run of follow-ups but the run once for recency', () => {
    const run = [
      call('m1', 'a', 'answered'),
      event('m1', 'a', 'COLD_CALL', { outcome: 'answered', followUpOf: 'x' }),
      event('m1', 'a', 'COLD_CALL', { outcome: 'answered', followUpOf: 'y' }),
    ];
    const meetings = [meeting('m1', run), meeting('m2', []), meeting('m3', [])];
    expect(grades(meetings.slice(0, 1), ['a'], config)[0]).toMatchObject({
      answers: 3,
      opportunities: 3,
    });
    const single = [
      meeting('m1', [call('m1', 'b', 'answered')]),
      meeting('m2', []),
      meeting('m3', []),
    ];
    // Three answers in meeting 1 and one answer in meeting 1 give the same recency at meeting 3.
    expect(eligibility(meetings, 2, ['a'])[0].sessionsSinceCalled).toBe(
      eligibility(single, 2, ['b'])[0].sessionsSinceCalled
    );
    expect(eligibility(meetings, 2, ['a'])[0].sessionsSinceCalled).toBe(1);
  });

  it('ignores undone calls and marks volunteers for today', () => {
    const answered = call('m1', 'a', 'answered');
    const events = [
      answered,
      event('m1', 'a', 'UNDO', {}, answered.id),
      event('m1', 'b', 'HAND_ACKNOWLEDGED', { handRaiseId: 'h' }),
    ];
    const result = eligibility([meeting('m1', events)], 0, ['a', 'b']);
    expect(result[0]).toMatchObject({ eligible: true, neverCalled: true });
    expect(result[1]).toMatchObject({ volunteered: true });
  });
});

describe('participation grade', () => {
  // Four meetings held of a 12-meeting term: projection factor 3.
  const term = { ...config, term_meetings: 12 };
  const meetings = [
    meeting('m1', [
      call('m1', 'a', 'answered'),
      call('m1', 'b', 'answered'),
      call('m1', 'c', 'pass'),
      event('m1', 'a', 'HAND_ACKNOWLEDGED'),
    ]),
    meeting('m2', [
      call('m2', 'a', 'answered'),
      call('m2', 'c', 'absent'),
      call('m2', 'd', 'retry'),
      event('m2', 'a', 'HAND_ACKNOWLEDGED'),
      event('m2', 'a', 'HAND_ACKNOWLEDGED'),
      event('m2', 'b', 'HAND_ACKNOWLEDGED'),
    ]),
    meeting('m3', [call('m3', 'b', 'answered'), call('m3', 'c', 'answered')]),
    meeting('m4', []),
  ];

  it('matches a hand-computed class', () => {
    // Answers a=2, b=2, c=1, d=0. Projected (x3): 6, 6, 3, 0. Median 4.5.
    // A = round(0.7 x 4.5 = 3.15) = 3. Volunteer cap = ceil(3 / 2) = 2.
    const result = grades(meetings, ['a', 'b', 'c', 'd'], term);
    expect(result.map((grade) => grade.A)).toEqual([3, 3, 3, 3]);
    expect(result[0]).toMatchObject({
      answers: 2,
      volunteerAnswers: 3,
      opportunities: 2,
      volunteerCap: 2,
      projectedAnswers: 6,
      // (2 + min(3, 2)) / min(3, 2) = 4 / 2, capped at 1.
      score: 1,
    });
    // b: (2 + 1) / min(3, 2) = 1.5, capped at 1.
    expect(result[1]).toMatchObject({ opportunities: 2, score: 1 });
    // c: 1 answer, 1 pass, 1 absence. 1 / min(3, 3).
    expect(result[2]).toMatchObject({ passes: 1, absences: 1, opportunities: 3 });
    expect(result[2].score).toBeCloseTo(1 / 3);
    // d: a retry is not an opportunity, so no score yet.
    expect(result[3]).toMatchObject({ opportunities: 0, score: null });
  });

  it('clamps A to its bounds', () => {
    const many = Array.from({ length: 10 }, () => call('m1', 'a', 'answered'));
    const high = grades([meeting('m1', many)], ['a'], { ...config, term_meetings: 30 });
    // Projected 300; 0.7 x 300 = 210, clamped to A_max = 8. Cap = 4.
    expect(high[0]).toMatchObject({ A: 8, volunteerCap: 4 });
    const low = grades([meeting('m1', [])], ['a'], config);
    expect(low[0].A).toBe(3);
    expect(grades([], ['a'], config)[0]).toMatchObject({ projectedAnswers: 0, A: 3 });
  });

  it('caps volunteer answers that exceed ceil(A / 2)', () => {
    const events = [
      ...Array.from({ length: 5 }, () => call('m1', 'a', 'pass')),
      ...Array.from({ length: 4 }, () => event('m1', 'a', 'HAND_ACKNOWLEDGED')),
    ];
    // A = 3 (floor), cap 2: (0 + 2) / min(3, 5) = 2/3.
    expect(grades([meeting('m1', events)], ['a'], config)[0].score).toBeCloseTo(2 / 3);
  });
});

describe('configuration', () => {
  it('falls back to defaults key by key', () => {
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(
      resolveConfig({ ratio: 0.5, pass_cap: 'x', term_meetings: 26, A_min: 9, A_max: 4 })
    ).toEqual({ ...DEFAULT_CONFIG, ratio: 0.5, term_meetings: 26 });
  });
});
