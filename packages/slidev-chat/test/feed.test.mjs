import test from 'node:test';
import assert from 'node:assert/strict';
import { followChat } from '../src/feed.mjs';

test('uses the projection socket and refreshes anonymous chat after moderation', async () => {
  let refresh;
  let disconnected = false;
  let cleared = false;
  const received = [];
  let messages = [{ id: '1', message: 'Question?', anonymousName: 'Swift Panda',
    createdAt: '2026-10-04', userId: 'private-student', user: { email: 'private@example.edu' } }];
  const stop = followChat({ server: 'https://class.example', ticket: 'signed-token',
    connectSocket: (_server, options) => {
      assert.equal(options.auth.ticket, 'signed-token');
      return { on: (event, callback) => { assert.equal(event, 'fetch-messages'); refresh = callback; },
        disconnect: () => { disconnected = true; } };
    },
    fetchImpl: async url => {
      assert.match(url, /\/api\/projection\/chat\?ticket=signed-token$/);
      return { ok: true, json: async () => ({ messages }) };
    },
    onMessages: value => received.push(value), onError: error => { throw error; },
    interval: () => 1, clear: () => { cleared = true; },
  });
  await refresh();
  assert.equal(received[0][0].anonymousName, 'Swift Panda');
  assert.equal(JSON.stringify(received).includes('private-student'), false);
  assert.equal(JSON.stringify(received).includes('private@example.edu'), false);
  messages = [];
  await refresh();
  assert.deepEqual(received.at(-1), []);
  stop();
  assert.equal(disconnected, true);
  assert.equal(cleared, true);
});

async function firstError(fetchImpl) {
  return new Promise(resolve => {
    followChat({ server: 'https://class.example', ticket: 'signed-token',
      connectSocket: () => ({ on: () => {}, disconnect: () => {} }),
      fetchImpl, onMessages: () => {}, onError: resolve, interval: () => 1, clear: () => {} });
  });
}

test('a refused ticket reports expired access', async () => {
  for (const status of [401, 403]) {
    const error = await firstError(async () => ({ ok: false, status }));
    assert.equal(error.kind, 'expired');
  }
});

test('an unreachable or failing server reports the chat unavailable', async () => {
  const offline = await firstError(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(offline.kind, 'unavailable');
  const failing = await firstError(async () => ({ ok: false, status: 502 }));
  assert.equal(failing.kind, 'unavailable');
  const garbled = await firstError(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }));
  assert.equal(garbled.kind, 'unavailable');
});

test('a refused ticket stops the feed', async () => {
  let fetches = 0;
  let disconnected = false;
  let cleared = false;
  const errors = [];
  let tick;
  followChat({ server: 'https://class.example', ticket: 'signed-token',
    connectSocket: () => ({ on: () => {}, disconnect: () => { disconnected = true; } }),
    fetchImpl: async () => { fetches += 1; return { ok: false, status: 403 }; },
    onMessages: () => {}, onError: error => errors.push(error.kind),
    interval: callback => { tick = callback; return 1; }, clear: () => { cleared = true; } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(errors, ['expired']);
  assert.equal(disconnected, true);
  assert.equal(cleared, true);
  await tick();
  assert.equal(fetches, 2);
  assert.deepEqual(errors, ['expired']);
});

test('an older response does not replace a newer one', async () => {
  const pending = [];
  const received = [];
  let tick;
  followChat({ server: 'https://class.example', ticket: 'signed-token',
    connectSocket: () => ({ on: () => {}, disconnect: () => {} }),
    fetchImpl: () => new Promise(resolve => pending.push(resolve)),
    onMessages: value => received.push(value.map(m => m.id)), onError: () => {},
    interval: callback => { tick = callback; return 1; }, clear: () => {} });
  const second = tick();
  const answer = ids => ({ ok: true, status: 200, json: async () => ({ messages: ids.map(id => ({ id, message: 'm', anonymousName: 'A', createdAt: '' })) }) });
  pending[1](answer(['new']));
  await second;
  pending[0](answer(['old']));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(received, [['new']]);
});
