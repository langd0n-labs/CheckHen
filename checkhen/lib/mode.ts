/**
 * Classroom mode runs behind the CheckHen access point. Hosted mode runs at a
 * regular URL: no network attendance and no exam lockdown.
 */
export type CheckhenMode = 'classroom' | 'hosted';

export function checkhenMode(): CheckhenMode {
  return process.env.CHECKHEN_MODE === 'hosted' ? 'hosted' : 'classroom';
}

export const EXAM_UNAVAILABLE =
  'Exam mode needs the classroom access point, so it is not available in hosted mode.';
