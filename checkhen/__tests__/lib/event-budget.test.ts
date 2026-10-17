import { sessionEventBudget } from '@/lib/event-budget';

afterEach(() => {
  delete process.env.CHECKHEN_SESSION_EVENT_BUDGET;
});

it('defaults to 20,000 events per session', () => {
  expect(sessionEventBudget()).toBe(20_000);
});

it('reads a positive whole number from the environment, and ignores anything else', () => {
  process.env.CHECKHEN_SESSION_EVENT_BUDGET = '500';
  expect(sessionEventBudget()).toBe(500);
  for (const value of ['0', '-5', '2.5', 'many']) {
    process.env.CHECKHEN_SESSION_EVENT_BUDGET = value;
    expect(sessionEventBudget()).toBe(20_000);
  }
});
