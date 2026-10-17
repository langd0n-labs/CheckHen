import { allowStudentWrite, resetWriteLimits } from '@/lib/write-limits';

beforeEach(() => {
  resetWriteLimits();
  delete process.env.CHECKHEN_DEMO;
  delete process.env.CHECKHEN_MODE;
});

it('allows a student up to the limit in a minute, then refuses', () => {
  const now = 1_000_000;
  for (let i = 0; i < 20; i += 1) expect(allowStudentWrite('s1', 'send-chat', now)).toBe(true);
  expect(allowStudentWrite('s1', 'send-chat', now)).toBe(false);
});

it('counts each student and each action separately', () => {
  const now = 1_000_000;
  for (let i = 0; i < 20; i += 1) allowStudentWrite('s1', 'send-chat', now);
  expect(allowStudentWrite('s2', 'send-chat', now)).toBe(true);
  expect(allowStudentWrite('s1', 'toggle-vhr', now)).toBe(true);
});

it('starts a new count after the window', () => {
  for (let i = 0; i < 21; i += 1) allowStudentWrite('s1', 'send-chat', 1_000_000);
  expect(allowStudentWrite('s1', 'send-chat', 1_060_000)).toBe(true);
});

it('does not limit actions it does not list', () => {
  for (let i = 0; i < 100; i += 1) expect(allowStudentWrite('s1', 'startup', 1_000_000)).toBe(true);
});

it('leaves the demo to its own gate', () => {
  process.env.CHECKHEN_DEMO = '1';
  process.env.CHECKHEN_MODE = 'hosted';
  for (let i = 0; i < 100; i += 1) expect(allowStudentWrite('s1', 'send-chat', 1_000_000)).toBe(true);
});
