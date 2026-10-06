/** F6 cold calling: sampler, eligibility, and participation grade. Pure functions only. */
import { effectiveEvents, type ParticipationEvent } from './events';

/** Skip: the student is briefly out of the room. It is recorded but changes nothing. */
export type ColdCallOutcome = 'answered' | 'pass' | 'retry' | 'absent' | 'skip';
export const OUTCOMES: ColdCallOutcome[] = ['answered', 'pass', 'retry', 'absent', 'skip'];
/** A follow-up continues with the student just called, who is in the room. */
export const FOLLOW_UP_OUTCOMES: ColdCallOutcome[] = ['answered', 'pass', 'retry'];

export type ColdCallConfig = {
  pass_cap: number;
  pass_multiplier: number;
  recency_multiplier: number;
  retry_multiplier: number;
  never_called_multiplier: number;
  volunteer_damping: number;
  /** Operator decision 2026-10-05: a student called this meeting stays callable at reduced weight. */
  called_today_damping: number;
  minimum_weight: number;
  ratio: number;
  A_min: number;
  A_max: number;
  component_weight: number;
  /** Meetings planned for the term. Null projects from the meetings held so far. */
  term_meetings: number | null;
};

export const DEFAULT_CONFIG: ColdCallConfig = {
  pass_cap: 2,
  pass_multiplier: 2.0,
  recency_multiplier: 0.5,
  retry_multiplier: 3.0,
  never_called_multiplier: 2.0,
  volunteer_damping: 0.6,
  called_today_damping: 0.2,
  minimum_weight: 0.01,
  ratio: 0.7,
  A_min: 3,
  A_max: 8,
  component_weight: 0.05,
  term_meetings: null,
};

/** Stored values override defaults one key at a time; invalid values fall back. */
export function resolveConfig(stored: unknown): ColdCallConfig {
  const values = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const config = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof ColdCallConfig)[]) {
    const value = values[key];
    if (key === 'term_meetings') {
      if (value === null || (Number.isInteger(value) && (value as number) > 0)) {
        config.term_meetings = value as number | null;
      }
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      config[key] = value;
    }
  }
  if (config.A_min > config.A_max) {
    config.A_min = DEFAULT_CONFIG.A_min;
    config.A_max = DEFAULT_CONFIG.A_max;
  }
  return config;
}

export type CandidateFeatures = {
  userId: string;
  passesOutstanding: number;
  sessionsSinceCalled: number;
  retryOutstanding: boolean;
  neverCalled: boolean;
  volunteered: boolean;
  /** Called earlier in this meeting, with no retry outstanding. */
  calledToday: boolean;
};

export function weight(features: CandidateFeatures, config: ColdCallConfig): number {
  const value =
    1.0 *
    (1 + config.pass_multiplier * Math.min(features.passesOutstanding, config.pass_cap)) *
    (1 + config.recency_multiplier * features.sessionsSinceCalled) *
    (features.retryOutstanding ? config.retry_multiplier : 1) *
    (features.neverCalled ? config.never_called_multiplier : 1) *
    (features.volunteered ? config.volunteer_damping : 1) *
    (features.calledToday ? config.called_today_damping : 1);
  return Number.isFinite(value) ? Math.max(value, config.minimum_weight) : config.minimum_weight;
}

/** Seeded generator (mulberry32). Library code never uses Math.random. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw one candidate with probability proportional to weight. */
export function select(
  candidates: CandidateFeatures[],
  config: ColdCallConfig,
  random: () => number
): string | null {
  if (!candidates.length) {
    return null;
  }
  // Sort by student ID so the caller's ordering never changes the draw.
  const sorted = candidates
    .slice()
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const weights = sorted.map((candidate) => weight(candidate, config));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let target = random() * total;
  for (let index = 0; index < sorted.length; index += 1) {
    target -= weights[index];
    if (target < 0) {
      return sorted[index].userId;
    }
  }
  return sorted[sorted.length - 1].userId;
}

/** One class meeting of the course, in meeting order, with its raw events. */
export type Meeting = { classId: string; courseId: string; events: ParticipationEvent[] };

type Record_ = {
  /** `order` is the event's position in its meeting, to compare with check-ins. */
  calls: { outcome: ColdCallOutcome; meeting: number; order: number }[];
  volunteers: number[];
  /** Position of the latest check-in in each meeting. */
  checkIns: Map<number, number>;
};

function records(meetings: Meeting[]): Map<string, Record_> {
  const byStudent = new Map<string, Record_>();
  const entry = (userId: string) => {
    if (!byStudent.has(userId)) {
      byStudent.set(userId, { calls: [], volunteers: [], checkIns: new Map() });
    }
    return byStudent.get(userId)!;
  };
  meetings.forEach((meeting, index) => {
    effectiveEvents(meeting.events, meeting).forEach((event, order) => {
      if (!event.userId) {
        return;
      }
      // A skip changes nothing, so it never enters the record.
      if (
        event.kind === 'COLD_CALL' &&
        event.payload.outcome !== 'skip' &&
        OUTCOMES.includes(event.payload.outcome as ColdCallOutcome)
      ) {
        entry(event.userId).calls.push({
          outcome: event.payload.outcome as ColdCallOutcome,
          meeting: index,
          order,
        });
      }
      if (event.kind === 'CHECK_IN') {
        entry(event.userId).checkIns.set(index, order);
      }
      // An instructor acknowledging a raised hand records a volunteer answer.
      if (event.kind === 'HAND_ACKNOWLEDGED') {
        entry(event.userId).volunteers.push(index);
      }
    });
  });
  return byStudent;
}

export type Eligibility = CandidateFeatures & { eligible: boolean };

/**
 * Sampler features for each present student at the meeting `current` (an index
 * into `meetings`). Absent outcomes do not count as being called. A student
 * marked absent is ineligible until they check in again.
 */
export function eligibility(
  meetings: Meeting[],
  current: number,
  present: string[]
): Eligibility[] {
  const history = records(meetings.slice(0, current + 1));
  return present.map((userId) => {
    const record: Record_ = history.get(userId) ?? {
      calls: [],
      volunteers: [],
      checkIns: new Map(),
    };
    let passesOutstanding = 0;
    let lastCalled: number | null = null;
    let retryOutstanding = false;
    let calledToday = false;
    let absentToday = false;
    for (const call of record.calls) {
      if (call.outcome === 'absent') {
        if (call.meeting === current && call.order > (record.checkIns.get(current) ?? -1)) {
          absentToday = true;
        }
        continue;
      }
      lastCalled = call.meeting;
      if (call.meeting === current) {
        calledToday = true;
      }
      retryOutstanding = call.outcome === 'retry';
      if (call.outcome === 'answered') {
        passesOutstanding = 0;
      }
      if (call.outcome === 'pass') {
        passesOutstanding += 1;
      }
    }
    return {
      userId,
      passesOutstanding,
      // Meetings between the last call and this one. Never called counts as called
      // before the first meeting, so both cases follow one rule.
      sessionsSinceCalled: lastCalled === null ? current : Math.max(0, current - lastCalled - 1),
      retryOutstanding,
      neverCalled: lastCalled === null,
      volunteered: record.volunteers.includes(current),
      calledToday: calledToday && !retryOutstanding,
      eligible: !absentToday,
    };
  });
}

export type ParticipationGrade = {
  userId: string;
  answers: number;
  passes: number;
  absences: number;
  volunteerAnswers: number;
  opportunities: number;
  projectedAnswers: number;
  A: number;
  volunteerCap: number;
  /** Null until the student has an opportunity or a counted volunteer answer. */
  score: number | null;
};

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Grade every roster student over the meetings held so far. */
export function grades(
  meetings: Meeting[],
  roster: string[],
  config: ColdCallConfig
): ParticipationGrade[] {
  const history = records(meetings);
  const held = meetings.length;
  const term = config.term_meetings ?? held;
  const counts = roster.map((userId) => {
    const record: Record_ = history.get(userId) ?? {
      calls: [],
      volunteers: [],
      checkIns: new Map(),
    };
    const count = (outcome: ColdCallOutcome) =>
      record.calls.filter((call) => call.outcome === outcome).length;
    const answers = count('answered');
    return {
      userId,
      answers,
      passes: count('pass'),
      absences: count('absent'),
      volunteerAnswers: record.volunteers.length,
      projectedAnswers: held ? answers * (term / held) : 0,
    };
  });
  const A = Math.min(
    config.A_max,
    Math.max(config.A_min, Math.round(config.ratio * median(counts.map((c) => c.projectedAnswers))))
  );
  const volunteerCap = Math.ceil(A / 2);
  return counts.map((count) => {
    const opportunities = count.answers + count.passes + count.absences;
    const earned = count.answers + Math.min(count.volunteerAnswers, volunteerCap);
    const denominator = Math.min(A, opportunities);
    return {
      ...count,
      opportunities,
      A,
      volunteerCap,
      score: denominator ? Math.min(1, earned / denominator) : earned ? 1 : null,
    };
  });
}
