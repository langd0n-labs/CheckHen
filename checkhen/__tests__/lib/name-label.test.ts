import { primaryName, instructorLabel } from '@/lib/name-label';

it('keeps the trusted name primary and the nickname secondary', () => {
  const user = { name: 'Alice Canonical', displayName: 'Ace', email: 'alice@example.edu' };
  expect(primaryName(user)).toBe('Alice Canonical');
  expect(instructorLabel(user)).toBe('Alice Canonical (Ace)');
});
it('uses the full email for legacy accounts without guessing a name from the nickname', () => {
  expect(primaryName({ name: null, email: 'alice@example.edu', ...{} })).toBe('alice@example.edu');
  expect(instructorLabel({ email: 'alice@example.edu', displayName: 'Ace' })).toBe('alice@example.edu (Ace)');
});
