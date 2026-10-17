/** A session has as many student-written events as it may hold. */
export class EventBudgetError extends Error {}

// A real class writes a few hundred events; this bounds what one session's reads fold.
const DEFAULT_SESSION_EVENT_BUDGET = 20_000;

/** CHECKHEN_SESSION_EVENT_BUDGET, or the default when it is unset or invalid. */
export function sessionEventBudget() {
  const value = Number(process.env.CHECKHEN_SESSION_EVENT_BUDGET);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SESSION_EVENT_BUDGET;
}
