export const TEST_EMAIL_DOMAIN = 'test.example';

export function makeTestEmail(index: number): string {
  return `student${String(index).padStart(3, '0')}@${TEST_EMAIL_DOMAIN}`;
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Approximate normal distribution via Box-Muller transform
export function normalRandom(mean: number, stdDev: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
}

export const MESSAGE_TEMPLATES = [
  'Can you explain that last part again?',
  'What is the time complexity of this approach?',
  'Is this going to be on the exam?',
  'I think there might be a mistake on the slide.',
  'Could you slow down a bit?',
  'Is this related to what we covered last week?',
  'Can you show an example of this in code?',
  'How does this compare to the other approach?',
  'What happens if the input is empty?',
  'Why do we use this data structure here?',
  'Can you repeat the last step?',
  'Is there a simpler way to think about this?',
  'Does this work for negative numbers too?',
  'How would we test this?',
  'Could you write that definition on the board?',
  'What is the space complexity?',
  'Is this always the best approach?',
  'Can we use a library for this?',
  'How do we handle edge cases?',
  'What does this line of code do exactly?',
];
