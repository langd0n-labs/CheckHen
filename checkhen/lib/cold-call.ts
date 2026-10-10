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

const whole = (value: number) => Number.isInteger(value);

/** Values that pass the per-key checks but break the grade, with the keys at fault. */
const CONFIG_RULES: {
  keys: (keyof ColdCallConfig)[];
  message: string;
  broken: (config: ColdCallConfig) => boolean;
}[] = [
  {
    keys: ['A_min', 'A_max'],
    message: 'The lowest and highest A must be whole numbers of at least 1',
    broken: (c) => !whole(c.A_min) || !whole(c.A_max) || c.A_min < 1,
  },
  {
    keys: ['A_min', 'A_max'],
    message: 'The lowest A must not exceed the highest A',
    broken: (c) => c.A_min > c.A_max,
  },
  {
    keys: ['pass_cap'],
    message: 'The most passes that add weight must be a whole number',
    broken: (c) => !whole(c.pass_cap),
  },
  {
    keys: ['ratio'],
    message: 'The target ratio must be more than 0',
    broken: (c) => c.ratio <= 0,
  },
  {
    keys: ['component_weight'],
    message: 'The share of the course grade must be at most 1',
    broken: (c) => c.component_weight > 1,
  },
  {
    keys: ['minimum_weight'],
    message: 'The lowest weight must be more than 0',
    broken: (c) => c.minimum_weight <= 0,
  },
];

/** Why a configuration cannot be saved, or null. */
export function configProblem(config: ColdCallConfig): string | null {
  return CONFIG_RULES.find((rule) => rule.broken(config))?.message ?? null;
}

/**
 * The settings in force for a course. Settings saved before validation existed
 * may break the grade; then only the settings at fault take their defaults, and
 * the problems are reported.
 */
export function courseConfig(stored: unknown): { config: ColdCallConfig; problem: string | null } {
  const config = resolveConfig(stored);
  const problems: string[] = [];
  // resolveConfig drops unusable saved values (negative, not a number, or the lowest A
  // above the highest) without a word; report each one it replaced.
  const saved = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const replaced = (Object.keys(DEFAULT_CONFIG) as (keyof ColdCallConfig)[]).filter(
    (key) => Object.hasOwn(saved, key) && saved[key] !== config[key]
  );
  if (replaced.length) {
    problems.push(`Saved values could not be used for ${replaced.join(', ')}`);
  }
  for (const rule of CONFIG_RULES) {
    if (rule.broken(config)) {
      for (const key of rule.keys) {
        (config as Record<string, unknown>)[key] = DEFAULT_CONFIG[key];
      }
      problems.push(rule.message);
    }
  }
  return { config, problem: problems.length ? problems.join('. ') : null };
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
  /** `free`: a Pass on a follow-up. It is a call, but neither an opportunity nor pass debt. */
  calls: { outcome: ColdCallOutcome; meeting: number; order: number; free: boolean }[];
  volunteers: number[];
  /** Meetings of absences the instructor excused. They are not opportunities. */
  excused: number[];
  /** Position of the latest check-in in each meeting. */
  checkIns: Map<number, number>;
};

function records(meetings: Meeting[]): Map<string, Record_> {
  const byStudent = new Map<string, Record_>();
  const entry = (userId: string) => {
    if (!byStudent.has(userId)) {
      byStudent.set(userId, { calls: [], volunteers: [], excused: [], checkIns: new Map() });
    }
    return byStudent.get(userId)!;
  };
  meetings.forEach((meeting, index) => {
    effectiveEvents(meeting.events, meeting).forEach((event, order) => {
      if (!event.userId) {
        return;
      }
      // A skip changes nothing, so it never enters the record. A Pass on a follow-up
      // (operator decision 2026-10-06) enters as a free call: it is a call for recency
      // and resolves a Retry, but costs no opportunity and adds no pass debt. A later
      // fresh draw that resolves a follow-up Retry is an ordinary call (operator,
      // 2026-10-06): a Pass on it counts.
      const isCall = event.kind === 'COLD_CALL' && event.payload.outcome !== 'skip';
      const followUp = !!event.payload.followUpOf;
      if (isCall && OUTCOMES.includes(event.payload.outcome as ColdCallOutcome)) {
        entry(event.userId).calls.push({
          outcome: event.payload.outcome as ColdCallOutcome,
          meeting: index,
          order,
          free: event.payload.outcome === 'pass' && followUp,
        });
      }
      // The excuse supersedes the Absent call, so the absence leaves the record.
      if (event.kind === 'COLD_CALL_EXCUSED') {
        entry(event.userId).excused.push(index);
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
      excused: [],
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
      if (call.outcome === 'pass' && !call.free) {
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
  excusedAbsences: number;
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
      excused: [],
      checkIns: new Map(),
    };
    const count = (outcome: ColdCallOutcome) =>
      record.calls.filter((call) => call.outcome === outcome && !call.free).length;
    const answers = count('answered');
    return {
      userId,
      answers,
      passes: count('pass'),
      absences: count('absent'),
      excusedAbsences: record.excused.length,
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
