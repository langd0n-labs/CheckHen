import { createHmac } from 'node:crypto';
import { purposeKey } from '@/lib/keys';
import { purposeKey as socketServerKey } from '../../../socket-server/src/keys';

it('derives a different key for each purpose, none equal to the secret', () => {
  const keys = (
    ['socket-ticket', 'projection-ticket', 'session-expiry', 'cold-call-draw'] as const
  ).map((purpose) => purposeKey(purpose, 'secret')!.toString('hex'));
  expect(new Set(keys).size).toBe(4);
  expect(keys).not.toContain(Buffer.from('secret').toString('hex'));
  expect(purposeKey('socket-ticket', 'secret')).toEqual(purposeKey('socket-ticket', 'secret'));
  expect(purposeKey('socket-ticket', 'other')).not.toEqual(purposeKey('socket-ticket', 'secret'));
});

it('has no key without a secret', () => {
  expect(purposeKey('socket-ticket', '')).toBeNull();
});

it('matches the socket server, so tickets the app signs verify there', () => {
  for (const purpose of ['socket-ticket', 'projection-ticket', 'session-expiry'] as const) {
    expect(socketServerKey(purpose, 'secret')).toEqual(purposeKey(purpose, 'secret'));
  }
  const body = 'payload';
  expect(
    createHmac('sha256', socketServerKey('session-expiry', 'secret')!).update(body).digest('hex')
  ).toBe(createHmac('sha256', purposeKey('session-expiry', 'secret')!).update(body).digest('hex'));
});
