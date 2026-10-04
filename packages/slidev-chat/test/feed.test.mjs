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
